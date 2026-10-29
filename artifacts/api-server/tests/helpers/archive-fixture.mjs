import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { isolatedQuotaStorage } from "./cloud-fixture.mjs";

const require = createRequire(import.meta.url);
const dbRequire = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));
function evaluate(code, load, env = {}) {
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", code)(
    load, module, module.exports, { env: { NODE_ENV: "production", LOG_LEVEL: "silent", ...env } },
  );
  return module.exports;
}
const database = await build({
  stdin: {
    contents: `
      export * from "./src/dialogue-archive-db";
      export * from "./src/schema/dialogue-archives";
      export * from "./src/schema/dialogue-archive-usage";
      export { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
    `,
    resolveDir: new URL("../../../../lib/db/", import.meta.url).pathname,
  },
  bundle: true, platform: "node", format: "cjs", write: false, external: ["pg"],
});
const application = await build({
  entryPoints: [new URL("../../src/app.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "cjs", write: false,
  external: ["archive-test-storage", "express", "express-rate-limit", "pino", "pino-http", "openai"],
  plugins: [{
    name: "isolated-archive-storage",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
        contents: 'module.exports = require("archive-test-storage");', loader: "js",
      }));
    },
  }],
});

export async function archiveStorage() {
  // A disposable Unix-socket-only PostgreSQL cluster, never configured data.
  const cluster = await isolatedQuotaStorage();
  const connectionString = `postgresql://quota_test@localhost/postgres?host=${encodeURIComponent(cluster.pool.options.host)}`;
  const storage = evaluate(database.outputFiles[0].text, dbRequire, { DATABASE_URL: connectionString });
  const { getTableConfig, PgDialect } = storage;
  const dialect = new PgDialect();
  for (const table of [storage.dialogueArchivesTable, storage.dialogueArchiveUsageTable]) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      assert.match(column.name, /^[a-z_]+$/);
      const defaultSql = column.default === undefined ? "" : ` DEFAULT ${dialect.sqlToQuery(column.default).sql}`;
      return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}` +
        `${column.notNull ? " NOT NULL" : ""}${defaultSql}`;
    });
    for (const check of config.checks) {
      columns.push(`CONSTRAINT "${check.name}" CHECK (${dialect.sqlToQuery(check.value).sql})`);
    }
    await cluster.pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
  }
  return {
    ...storage, pool: cluster.pool,
    independentDatabase() {
      return evaluate(database.outputFiles[0].text, dbRequire, { DATABASE_URL: connectionString });
    },
    async close() { await storage.dialogueArchivePool.end(); await cluster.close(); },
  };
}

export const validArchive = {
  consent: true, title: "Synthetic test archive",
  lines: [{ sourceText: "テスト", translatedText: "Synthetic dialogue", timestamp: 1 }],
};
let client = 0;
export async function archiveServer(t, storage, { independentPool = false } = {}) {
  if (independentPool) {
    storage = storage.independentDatabase();
    t.after(() => storage.dialogueArchivePool.end());
  }
  const app = evaluate(application.outputFiles[0].text, (id) =>
    id === "archive-test-storage" ? storage : require(id)).default;
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve); server.once("error", reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return async ({ method = "POST", body = validArchive, code, rawBody, ip } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/dialogue-archives`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip ?? `192.0.${Math.floor(++client / 250)}.${client % 250 + 1}`,
        ...(code ? { authorization: `Bearer ${code}` } : {}),
      },
      body: method === "POST" ? rawBody ?? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };
}

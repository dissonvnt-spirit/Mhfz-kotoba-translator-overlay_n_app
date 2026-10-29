import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const dbRequire = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));

function evaluate(code, load = require, env = {}, Clock = Date) {
  const module = { exports: {} };
  // Never expose configured credentials to the bundled application.
  const isolatedProcess = Object.create(process);
  isolatedProcess.env = { NODE_ENV: "production", LOG_LEVEL: "silent", ...env };
  new Function("require", "module", "exports", "process", "Date", code)(
    load, module, module.exports, isolatedProcess, Clock,
  );
  return module.exports;
}

// Externalize these boundaries at build time, not by changing production code.
// Every app gets its own module state (including its concurrency limiter).
const appBundle = await build({
  entryPoints: [new URL("../../src/app.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "cjs", write: false,
  external: ["kotoba-test-storage", "openai", "express", "express-rate-limit", "pino", "pino-http"],
  plugins: [{
    name: "isolated-quota-storage",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
        path: "quota-storage", namespace: "test",
      }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
        contents: 'module.exports = require("kotoba-test-storage");',
        loader: "js",
      }));
    },
  }],
});
const dbBundle = await build({
  stdin: {
    contents: `
      export { drizzle } from "drizzle-orm/node-postgres";
      export { getTableConfig } from "drizzle-orm/pg-core";
      export { cloudUsageTable } from "./src/schema/cloud-usage";
      export { default as pg } from "pg";
    `,
    resolveDir: new URL("../../../../lib/db/", import.meta.url).pathname,
  },
  bundle: true, platform: "node", format: "cjs", write: false,
  external: ["pg"],
});
export const { drizzle, getTableConfig, cloudUsageTable, pg } =
  evaluate(dbBundle.outputFiles[0].text, dbRequire);

export class SyntheticProviderError extends Error {
  constructor(status) {
    super("synthetic provider failure: private diagnostic");
    this.status = status;
  }
}

export async function isolatedQuotaStorage() {
  // A new Unix-socket-only cluster, never DATABASE_URL or an existing server.
  // POSTGRES_BIN may locate PostgreSQL tools outside PATH (e.g. CI runners).
  const directory = await mkdtemp(join(tmpdir(), "kotoba-quota-"));
  const data = join(directory, "data");
  const run = (tool, args) => execFileSync(
    process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, tool) : tool,
    args,
    { encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH, LC_ALL: "C" } },
  );
  let started = false;
  let pool;
  async function close() {
    try {
      await pool?.end();
    } finally {
      try {
        if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
  try {
    run("initdb", ["-D", data, "-U", "quota_test", "--no-locale", "--encoding=UTF8",
      "--auth-local=trust", "--auth-host=reject"]);
    run("pg_ctl", ["-D", data, "-l", join(directory, "postgres.log"), "-o",
      `-F -h '' -k '${directory}'`, "-w", "start"]);
    started = true;
    pool = new pg.Pool({
      host: directory, port: 5432, user: "quota_test", database: "postgres", max: 20,
    });
    // Build the fixture from the actual schema, not a mock of the upsert.
    const config = getTableConfig(cloudUsageTable);
    const columns = config.columns.map((column) => {
      assert.match(column.name, /^[a-z_]+$/);
      assert.ok(column.default === undefined || typeof column.default === "number");
      return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}` +
        `${column.notNull ? " NOT NULL" : ""}` +
        `${column.default === undefined ? "" : ` DEFAULT ${column.default}`}`;
    });
    assert.equal(config.name, "kotoba_cloud_usage");
    await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    return { pool, db: drizzle(pool), close };
  } catch (error) {
    await close();
    throw new Error("Quota tests need local PostgreSQL initdb/pg_ctl tools and a non-root user. Set POSTGRES_BIN if needed.", { cause: error });
  }
}

export async function cloudServer(t, {
  storage, env = {}, now = () => "2026-10-28T12:00:00.000Z",
  provider = async () => ({ choices: [{ message: { content: "Hello." } }] }),
  storageError,
} = {}) {
  const calls = [];
  const clients = [];
  let storageLoads = 0;
  class SyntheticOpenAI {
    static APIError = SyntheticProviderError;
    constructor(options) {
      clients.push(options);
    }
    chat = { completions: { create: async (request) => {
      calls.push(request);
      return provider(request);
    } } };
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now()])); }
  }
  const app = evaluate(appBundle.outputFiles[0].text, (id) => {
    if (id === "openai") return SyntheticOpenAI;
    if (id === "kotoba-test-storage") {
      storageLoads++;
      if (storageError) throw storageError;
      assert.ok(storage, "A test storage adapter is required");
      return { db: storage.db, cloudUsageTable };
    }
    return require(id);
  }, {
    KOTOBA_PUBLIC_CLOUD_ENABLED: "true", OPENAI_API_KEY: "synthetic-test-key",
    KOTOBA_CLOUD_DAILY_LIMIT: "3", ...env,
  }, Clock).default;
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  let client = 0;
  return {
    calls, clients,
    get storageLoads() { return storageLoads; },
    async translate(options = {}) {
      const { consent = "yes", text = "こんにちは", body = { text } } = options;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/cloud/translate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Distinct synthetic clients prevent the per-IP limiter masking quota failures.
          "x-forwarded-for": `192.0.2.${++client}`,
          ...(consent === null ? {} : { "x-kotoba-cloud-consent": consent }),
        },
        // An explicit undefined rawBody sends no body, rather than JSON "{}".
        body: Object.hasOwn(options, "rawBody") ? options.rawBody : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      // Express parser errors use HTML; do not add test-only error middleware.
      const responseBody = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() : await response.text();
      return { status: response.status, body: responseBody, headers: response.headers };
    },
  };
}

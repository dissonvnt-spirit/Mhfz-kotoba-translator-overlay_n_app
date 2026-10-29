import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { build } from "esbuild";

// Keep the real app/router/middleware, but never import the database entrypoint:
// archive routes eagerly import it, pulling drizzle-zod schema initialization
// into this CJS bundle (which previously failed with "Class2 is not a constructor").
// No database or paid-provider implementation belongs in this middleware suite.
const require = createRequire(import.meta.url);
const serviceToken = "test-only-service-token-".repeat(2);
const isolatedProcess = Object.create(process);
isolatedProcess.env = {
  NODE_ENV: "production",
  LOG_LEVEL: "silent",
  KOTOBA_API_TOKEN: serviceToken,
};
let storageCalls = 0;
let providerCalls = 0;
const forbiddenStorage = new Proxy({}, {
  get() {
    storageCalls++;
    throw new Error("Database access is forbidden in hardening tests");
  },
});
const storage = {
  db: forbiddenStorage,
  dialogueArchiveDb: forbiddenStorage,
  dialogueArchivesTable: forbiddenStorage,
  dialogueArchiveUsageTable: forbiddenStorage,
  cloudUsageTable: forbiddenStorage,
};
class ForbiddenProvider {
  static APIError = class extends Error {};
  constructor() {
    providerCalls++;
    throw new Error("Paid provider access is forbidden in hardening tests");
  }
}
const { outputFiles, metafile } = await build({
  entryPoints: [new URL("../src/app.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  metafile: true,
  external: ["hardening-test-storage", "openai", "express", "express-rate-limit", "pino", "pino-http"],
  plugins: [{
    name: "isolated-hardening-storage",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
        path: "storage", namespace: "hardening-test",
      }));
      builder.onLoad({ filter: /.*/, namespace: "hardening-test" }, () => ({
        contents: 'module.exports = require("hardening-test-storage");',
        loader: "js",
      }));
      // Fail at build time if a future import bypasses the storage boundary.
      builder.onLoad({ filter: /[\\/]lib[\\/]db[\\/]|[\\/]node_modules[\\/](?:pg|pg-pool|drizzle-zod)[\\/]/ }, () => {
        throw new Error("Live database implementation must not enter the hardening bundle");
      });
    },
  }],
});
const appModule = { exports: {} };
const runtimeDependencies = new Set(["express", "express-rate-limit", "pino", "pino-http"]);
new Function("require", "module", "exports", "process", outputFiles[0].text)(
  (id) => {
    if (id === "hardening-test-storage") return storage;
    if (id === "openai") return ForbiddenProvider;
    if (id.startsWith("node:") || runtimeDependencies.has(id)) return require(id);
    throw new Error(`Unexpected hardening runtime dependency: ${id}`);
  },
  appModule, appModule.exports, isolatedProcess,
);
const app = appModule.exports.default;
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  } finally {
    // Routes catch storage/provider exceptions; make attempted calls fail the
    // suite even if production error handling converted them into an HTTP 503.
    assert.equal(storageCalls, 0, "hardening requests must not access storage");
    assert.equal(providerCalls, 0, "hardening requests must not construct a paid provider");
  }
});

async function translate(ip, headers = {}, body = "{}") {
  const response = await fetch(`${baseUrl}/api/translate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...headers,
    },
    body,
  });
  await response.arrayBuffer();
  return response;
}

test("hardening runs without configured credentials, database code, or a paid SDK", () => {
  assert.deepEqual(Object.keys(isolatedProcess.env).sort(), [
    "KOTOBA_API_TOKEN", "LOG_LEVEL", "NODE_ENV",
  ]);
  const inputs = Object.keys(metafile.inputs);
  assert.ok(inputs.some((path) => path.endsWith("/routes/dialogue-archives.ts")),
    "the real archive router must remain mounted");
  assert.ok(inputs.some((path) => path.endsWith("/routes/cloud-translate.ts")),
    "the real cloud router must remain mounted");
  for (const path of inputs) {
    assert.doesNotMatch(path, /(?:^|\/)lib\/db\/|node_modules\/(?:pg|pg-pool|drizzle-zod|openai)\//);
  }
});

test("arbitrary, null, lookalike, and dev browser origins get no CORS permission", async () => {
  for (const origin of [
    "https://attacker.example",
    "null",
    "http://tauri.localhost.attacker.example",
    "http://localhost:1420",
  ]) {
    const response = await translate("192.0.2.1", { origin });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
    const preflight = await fetch(`${baseUrl}/api/translate`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    await preflight.arrayBuffer();
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
    assert.equal(preflight.headers.get("access-control-allow-headers"), null);
  }
});

test("packaged desktop origins can preflight and send authenticated requests", async () => {
  for (const origin of ["http://tauri.localhost", "tauri://localhost"]) {
    const preflight = await fetch(`${baseUrl}/api/translate`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    await preflight.arrayBuffer();
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
    assert.equal(preflight.headers.get("access-control-allow-headers"), "Authorization,Content-Type,X-Kotoba-Cloud-Consent");
    assert.ok(preflight.headers.get("vary").includes("Origin"));
    const response = await translate("192.0.2.8", {
      origin,
      authorization: `Bearer ${serviceToken}`,
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
});

test("packaged desktop origins can preflight the explicit cloud consent header", async () => {
  for (const origin of ["http://tauri.localhost", "tauri://localhost"]) {
    const response = await fetch(`${baseUrl}/api/cloud/translate`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-kotoba-cloud-consent",
      },
    });
    await response.arrayBuffer();
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.ok(response.headers.get("access-control-allow-headers").toLowerCase().split(",").includes("x-kotoba-cloud-consent"));
  }
});

test("native/same-origin requests still require auth and validate input", async () => {
  assert.equal((await translate("192.0.2.2")).status, 401);
  assert.equal((await translate("192.0.2.2", {
    authorization: "Bearer incorrect-token",
  })).status, 401);
  assert.equal((await translate("192.0.2.2", {
    authorization: `Bearer ${serviceToken}`,
  })).status, 400);
});

test("failed auth consumes quota, throttles at 61, and clients have separate buckets", async () => {
  for (let i = 0; i < 60; i++) {
    const headers = i % 2 ? { authorization: "Bearer incorrect-token" } : {};
    assert.equal((await translate("192.0.2.3", headers)).status, 401);
  }
  const blocked = await translate("192.0.2.3");
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
  assert.ok(blocked.headers.get("ratelimit"));
  assert.equal((await translate("192.0.2.4")).status, 401);
  // Even a valid token cannot bypass the exhausted IP quota.
  assert.equal((await translate("192.0.2.3", {
    authorization: `Bearer ${serviceToken}`,
  })).status, 429);
});

test("untrusted forwarding-chain entries cannot rotate a client's quota", async () => {
  assert.equal(app.get("trust proxy"), 1);
  for (let i = 0; i < 60; i++) {
    assert.equal((await translate(`198.51.100.${i + 1}, 192.0.2.5`)).status, 401);
  }
  assert.equal((await translate("203.0.113.123, 192.0.2.5")).status, 429);
  assert.equal((await translate("203.0.113.123, 192.0.2.6")).status, 401);
});

test("IPv6 addresses in one subnet cannot rotate the quota", async () => {
  for (let i = 0; i < 60; i++) {
    assert.equal((await translate(`2001:db8:abcd:1200::${i + 1}`)).status, 401);
  }
  assert.equal((await translate("2001:db8:abcd:1200::ffff")).status, 429);
  assert.equal((await translate("2001:db8:abcd:1300::1")).status, 401);
});

test("the existing body size limit is retained", async () => {
  assert.equal((await translate("192.0.2.7", {}, JSON.stringify({
    text: "a".repeat(9000),
  }))).status, 413);
});

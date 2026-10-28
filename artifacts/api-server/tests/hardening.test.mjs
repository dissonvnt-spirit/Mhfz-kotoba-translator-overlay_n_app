import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { build } from "esbuild";

// Bundle the actual app without opening its production listener or using any
// configured credentials. Invalid bodies ensure no provider calls can occur.
process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";
process.env.KOTOBA_API_TOKEN = "test-only-service-token-".repeat(2);
delete process.env.OPENAI_API_KEY;
globalThis.require = createRequire(import.meta.url);
const { outputFiles } = await build({
  entryPoints: [new URL("../src/app.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const appModule = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(
  globalThis.require, appModule, appModule.exports,
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
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
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
    assert.equal(preflight.headers.get("access-control-allow-headers"), "Authorization,Content-Type");
    assert.ok(preflight.headers.get("vary").includes("Origin"));
    const response = await translate("192.0.2.8", {
      origin,
      authorization: `Bearer ${process.env.KOTOBA_API_TOKEN}`,
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
});

test("native/same-origin requests still require auth and validate input", async () => {
  assert.equal((await translate("192.0.2.2")).status, 401);
  assert.equal((await translate("192.0.2.2", {
    authorization: "Bearer incorrect-token",
  })).status, 401);
  assert.equal((await translate("192.0.2.2", {
    authorization: `Bearer ${process.env.KOTOBA_API_TOKEN}`,
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
    authorization: `Bearer ${process.env.KOTOBA_API_TOKEN}`,
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

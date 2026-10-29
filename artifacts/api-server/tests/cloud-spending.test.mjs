import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { cloudServer, cloudUsageTable, getTableConfig, isolatedQuotaStorage, SyntheticProviderError } from "./helpers/cloud-fixture.mjs";

let storage;
before(async () => { storage = await isolatedQuotaStorage(); });
after(async () => { await storage?.close(); });
beforeEach(async () => { await storage.pool.query("TRUNCATE kotoba_cloud_usage"); });

async function usage() {
  const { rows } = await storage.pool.query(
    "SELECT day::text, requests FROM kotoba_cloud_usage ORDER BY day",
  );
  return rows;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function providerStarted(pending) {
  let timer;
  try {
    await Promise.race([
      pending.started.promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Provider call did not start")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const outcome of ["resolve", "reject"]) {
  test(`busy guard releases capacity when stalled provider calls ${outcome}`, async (t) => {
    const pending = Array.from({ length: 5 }, () => ({
      started: deferred(), result: deferred(),
    }));
    const requests = [];
    let next = 0;
    const app = await cloudServer(t, {
      storage,
      // Leave ample quota so only the process-local busy guard can block.
      env: { KOTOBA_CLOUD_DAILY_LIMIT: "10" },
      provider: () => {
        const call = pending[next++];
        assert.ok(call, "Unexpected extra provider call");
        call.started.resolve();
        return call.result.promise;
      },
    });
    t.after(async () => {
      // Always unblock HTTP handlers, including when an assertion fails.
      for (const call of pending) {
        call.result.resolve({ choices: [{ message: { content: "Hello." } }] });
      }
      await Promise.allSettled(requests);
    });
    const start = async (index) => {
      requests.push(app.translate());
      await providerStarted(pending[index]);
    };
    const settle = (index) => {
      if (outcome === "reject") {
        pending[index].result.reject(new Error("Synthetic stalled provider failure"));
      } else {
        pending[index].result.resolve({ choices: [{ message: { content: "Hello." } }] });
      }
    };
    const assertBusy = async (reservations) => {
      const { status, body } = await app.translate();
      assert.deepEqual({ status, body }, {
        status: 429,
        body: { error: "Cloud translation is busy. Try again shortly or switch to offline." },
      });
      assert.equal(app.calls.length, reservations);
      assert.equal(app.clients.length, reservations);
      assert.deepEqual(await usage(), [{ day: "2026-10-28", requests: reservations }]);
    };
    const expectedStatus = outcome === "reject" ? 503 : 200;

    await start(0);
    await start(1);
    await assertBusy(2);

    // Finishing one call frees exactly one slot while the other stays stalled.
    settle(0);
    assert.equal((await requests[0]).status, expectedStatus);
    await start(2);
    await assertBusy(3);

    settle(1);
    settle(2);
    assert.equal((await requests[1]).status, expectedStatus);
    assert.equal((await requests[2]).status, expectedStatus);

    // Both slots must be reusable, not just the first one released.
    await start(3);
    await start(4);
    await assertBusy(5);
    settle(3);
    settle(4);
    assert.equal((await requests[3]).status, expectedStatus);
    assert.equal((await requests[4]).status, expectedStatus);
    assert.deepEqual(await usage(), [{ day: "2026-10-28", requests: 5 }]);
  });
}

test("quota schema stores only aggregate UTC-day counts with a unique day and zero default", async () => {
  const config = getTableConfig(cloudUsageTable);
  assert.deepEqual(config.columns.map((c) => [c.name, c.getSQLType(), c.primary, c.notNull]), [
    ["day", "date", true, true], ["requests", "integer", false, true],
  ]);
  await storage.pool.query("INSERT INTO kotoba_cloud_usage (day) VALUES ('2026-10-28')");
  assert.deepEqual(await usage(), [{ day: "2026-10-28", requests: 0 }]);
  await assert.rejects(
    storage.pool.query("INSERT INTO kotoba_cloud_usage (day) VALUES ('2026-10-28')"),
    { code: "23505" },
  );
  await assert.rejects(
    storage.pool.query("INSERT INTO kotoba_cloud_usage (day, requests) VALUES ('2026-10-29', NULL)"),
    { code: "23502" },
  );
});

for (const [label, configured, effectiveLimit] of [
  ["absent configuration", undefined, 100],
  ["minimum positive integer", "1", 1],
  ["positive integer below the default", "7", 7],
  ["positive integer above the default", "250", 250],
  ["maximum allowed limit", "1000", 1000],
  ["integer above the cap", "1001", 1000],
  ["largest safe integer", "9007199254740991", 1000],
  ["zero", "0", 100],
  ["negative integer", "-5", 100],
  ["fractional number", "1.5", 100],
  ["fractional number above the cap", "1000.5", 100],
  ["nonnumeric text", "invalid", 100],
  ["unsafe integer", "9007199254740992", 100],
  ["empty string", "", 100],
  ["NaN", "NaN", 100],
  ["infinity", "Infinity", 100],
]) {
  test(`daily limit normalizes ${label} to ${effectiveLimit}`, async (t) => {
    // Seed immediately below the effective boundary: no bulk provider calls.
    await storage.pool.query(
      "INSERT INTO kotoba_cloud_usage (day, requests) VALUES ('2026-10-28', $1)",
      [effectiveLimit - 1],
    );
    const app = await cloudServer(t, {
      storage,
      // Override the fixture's small default, including when config is absent.
      env: { KOTOBA_CLOUD_DAILY_LIMIT: configured },
    });

    const { status, body } = await app.translate();
    assert.deepEqual({ status, body }, {
      status: 200, body: { sourceText: "こんにちは", translatedText: "Hello." },
    });
    assert.equal(app.calls.length, 1);
    assert.equal(app.clients.length, 1);
    assert.deepEqual(await usage(), [{ day: "2026-10-28", requests: effectiveLimit }]);

    for (let attempt = 0; attempt < 2; attempt++) {
      const blocked = await app.translate();
      assert.equal(blocked.status, 429);
      assert.match(blocked.body.error, /allowance is used up/);
      assert.equal(app.calls.length, 1, "Exhausted quota must not call the provider");
      assert.equal(app.clients.length, 1, "Exhausted quota must not construct OpenAI");
      assert.deepEqual(await usage(), [{ day: "2026-10-28", requests: effectiveLimit }]);
    }
  });
}

test("competing instances cannot overspend an empty or nearly exhausted shared day", async (t) => {
  for (const initial of [0, 2]) {
    await storage.pool.query("TRUNCATE kotoba_cloud_usage");
    if (initial) {
      await storage.pool.query("INSERT INTO kotoba_cloud_usage VALUES ('2026-10-28', $1)", [initial]);
    }
    // Separate app modules model independent autoscale instances. A single-app
    // burst would only exercise the process-local two-request busy guard.
    const apps = await Promise.all(Array.from({ length: 12 }, () => cloudServer(t, { storage })));
    const results = await Promise.all(apps.map((app) => app.translate()));
    assert.equal(results.filter((r) => r.status === 200).length, 3 - initial);
    assert.equal(results.filter((r) => r.status === 429).length, 12 - (3 - initial));
    for (const result of results.filter((r) => r.status === 429)) {
      assert.match(result.body.error, /allowance is used up/);
    }
    assert.equal(apps.reduce((sum, app) => sum + app.calls.length, 0), 3 - initial);
    assert.deepEqual(await usage(), [{ day: "2026-10-28", requests: 3 }]);
    // A fresh instance must not reset or bypass the stored allowance.
    const restarted = await cloudServer(t, { storage });
    assert.equal((await restarted.translate()).status, 429);
    assert.equal(restarted.calls.length, 0);
  }
});

test("UTC midnight starts a new allowance regardless of the timestamp's local day", async (t) => {
  let instant = "2026-10-28T16:59:59-07:00"; // 23:59:59 UTC
  const app = await cloudServer(t, {
    storage, now: () => instant, env: { KOTOBA_CLOUD_DAILY_LIMIT: "1" },
  });
  assert.equal((await app.translate()).status, 200);
  assert.equal((await app.translate()).status, 429);
  instant = "2026-10-28T17:00:00-07:00"; // next UTC day, same local day
  assert.equal((await app.translate()).status, 200);
  assert.equal((await app.translate()).status, 429);
  assert.equal(app.calls.length, 2);
  assert.deepEqual(await usage(), [
    { day: "2026-10-28", requests: 1 }, { day: "2026-10-29", requests: 1 },
  ]);
});

test("missing or unavailable quota storage fails closed before constructing OpenAI", async (t) => {
  const missing = await cloudServer(t, { storageError: new Error("DATABASE_URL must be set") });
  for (let i = 0; i < 3; i++) assert.equal((await missing.translate()).status, 503);
  assert.ok(missing.storageLoads > 0);
  assert.equal(missing.clients.length, 0);
  assert.equal(missing.calls.length, 0);

  // Exercise a real SQL error too, not only a rejected module load.
  await storage.pool.query("ALTER TABLE kotoba_cloud_usage RENAME TO hidden_quota");
  const unavailable = await cloudServer(t, { storage });
  try {
    assert.equal((await unavailable.translate()).status, 503);
    assert.equal(unavailable.clients.length, 0);
    assert.equal(unavailable.calls.length, 0);
  } finally {
    await storage.pool.query("ALTER TABLE hidden_quota RENAME TO kotoba_cloud_usage");
  }
  assert.deepEqual(await usage(), []);
  // Storage recovery also proves failures released the active-request slot.
  assert.equal((await unavailable.translate()).status, 200);
});

test("provider failures and empty responses retain reservations without retries or error leaks", async (t) => {
  let attempt = 0;
  const app = await cloudServer(t, { storage, env: { KOTOBA_CLOUD_DAILY_LIMIT: "5" }, provider: async () => {
    attempt++;
    if (attempt === 1) throw new Error("synthetic provider timeout: private diagnostic");
    if (attempt === 2) throw new SyntheticProviderError(429);
    if (attempt === 3) throw new SyntheticProviderError(500);
    if (attempt === 4) return { choices: [] };
    return { choices: [{ message: { content: "   " } }] };
  } });
  for (const [index, status] of [503, 503, 503, 502, 502].entries()) {
    const result = await app.translate();
    assert.equal(result.status, status);
    assert.doesNotMatch(JSON.stringify(result.body), /private diagnostic|synthetic-test-key/);
    assert.deepEqual(await usage(), [{ day: "2026-10-28", requests: index + 1 }]);
  }
  const blocked = await app.translate();
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /allowance is used up/);
  assert.equal(app.calls.length, 5);
  assert.equal(app.clients.length, 5);
  for (const client of app.clients) {
    assert.equal(client.maxRetries, 0);
    assert.equal(client.timeout, 25_000);
  }
});

test("missing or incorrect consent and disabled cloud never reserve or call OpenAI", async (t) => {
  const app = await cloudServer(t, { storage });
  for (const consent of [null, "", "no", "YES"]) {
    assert.equal((await app.translate({ consent })).status, 400);
  }
  assert.equal(app.storageLoads, 0);
  assert.equal(app.clients.length, 0);
  assert.equal(app.calls.length, 0);
  for (const env of [
    { KOTOBA_PUBLIC_CLOUD_ENABLED: undefined },
    { KOTOBA_PUBLIC_CLOUD_ENABLED: "false" },
    { KOTOBA_PUBLIC_CLOUD_ENABLED: "TRUE" },
    { OPENAI_API_KEY: undefined },
  ]) {
    const disabled = await cloudServer(t, { storage, env });
    assert.equal((await disabled.translate()).status, 503);
    assert.equal(disabled.storageLoads, 0);
    assert.equal(disabled.clients.length, 0);
    assert.equal(disabled.calls.length, 0);
  }
  assert.deepEqual(await usage(), []);
});

for (const [label, body] of [
  ["empty text", { text: "" }],
  ["whitespace-only text", { text: " \t\r\n\u3000" }],
  ["2001-character text", { text: "あ".repeat(2001) }],
  ["missing text", {}],
  ["null text", { text: null }],
  ["numeric text", { text: 123 }],
  ["boolean text", { text: true }],
  ["array text", { text: ["こんにちは"] }],
  ["object text", { text: { dialogue: "こんにちは" } }],
]) {
  test(`invalid dialogue with ${label} is rejected before quota storage or OpenAI`, async (t) => {
    // Cloud is enabled and consent is valid so only dialogue validation rejects.
    const app = await cloudServer(t, { storage });
    const { status, body: responseBody } = await app.translate({ body });
    assert.deepEqual({ status, body: responseBody }, {
      status: 400,
      body: { error: "Enter between 1 and 2000 characters of dialogue." },
    });
    assert.equal(app.storageLoads, 0, "Invalid dialogue must not load quota storage");
    assert.equal(app.clients.length, 0, "Invalid dialogue must not construct OpenAI");
    assert.equal(app.calls.length, 0, "Invalid dialogue must not call the provider");
    assert.deepEqual(await usage(), []);
  });
}

// Padding keeps dialogue valid, so a 413 must come from app.ts's parser, not
// the route's 2000-character validation. The limit applies to UTF-8 bytes.
function jsonWithBytes(bytes, text = "こんにちは") {
  const body = { text, padding: "" };
  body.padding = "a".repeat(bytes - Buffer.byteLength(JSON.stringify(body)));
  const raw = JSON.stringify(body);
  assert.equal(Buffer.byteLength(raw), bytes);
  return raw;
}

for (const [label, rawBody, status] of [
  ["malformed JSON", '{"text":"こんにちは"', 400],
  ["absent body", undefined, 400],
  ["empty body", "", 400],
  ["8193-byte ASCII JSON", jsonWithBytes(8193, "Hello"), 413],
  ["8193-byte multibyte JSON", jsonWithBytes(8193, "あ".repeat(1999)), 413],
]) {
  for (const seeded of [false, true]) {
    test(`${label} through the production parser leaves ${seeded ? "existing" : "empty"} usage unchanged`, async (t) => {
      if (seeded) {
        await storage.pool.query(
          "INSERT INTO kotoba_cloud_usage (day, requests) VALUES ('2026-10-27', 3), ('2026-10-28', 1)",
        );
      }
      const initialUsage = await usage();
      const app = await cloudServer(t, { storage });
      const result = await app.translate({ rawBody });
      assert.equal(result.status, status);
      assert.match(result.headers.get("content-type"), /^application\/json\b/);
      if (rawBody === undefined || rawBody === "") {
        assert.deepEqual(result.body, { error: "Enter between 1 and 2000 characters of dialogue." });
      } else if (status === 413) {
        // app.ts shares this JSON parser-error contract with archive requests,
        // but cloud requests must still be rejected at their own 8 KiB limit.
        assert.deepEqual(result.body, {
          error: "File/import is too large. Use at most 1 MiB per archive.",
        });
      } else {
        assert.deepEqual(result.body, { error: "Invalid JSON request." });
      }
      assert.equal(app.storageLoads, 0, "Broken requests must not load quota storage");
      assert.equal(app.clients.length, 0, "Broken requests must not construct OpenAI");
      assert.equal(app.calls.length, 0, "Broken requests must not call the provider");
      assert.deepEqual(await usage(), initialUsage);
    });
  }
}

test("valid JSON at exactly the production 8192-byte limit consumes one reservation", async (t) => {
  const text = "あ".repeat(1999);
  const app = await cloudServer(t, { storage });
  const { status, body } = await app.translate({ rawBody: jsonWithBytes(8192, text) });
  assert.deepEqual({ status, body }, {
    status: 200, body: { sourceText: text, translatedText: "Hello." },
  });
  assert.equal(app.storageLoads, 1);
  assert.equal(app.clients.length, 1);
  assert.equal(app.calls.length, 1);
  assert.deepEqual(await usage(), [{ day: "2026-10-28", requests: 1 }]);
});

for (const length of [1, 2000]) {
  test(`${length}-character dialogue is accepted and consumes exactly one reservation`, async (t) => {
    const text = "あ".repeat(length);
    const app = await cloudServer(t, { storage });
    const { status, body } = await app.translate({ text });
    assert.deepEqual({ status, body }, {
      status: 200, body: { sourceText: text, translatedText: "Hello." },
    });
    assert.equal(app.storageLoads, 1);
    assert.equal(app.clients.length, 1);
    assert.equal(app.calls.length, 1);
    assert.deepEqual(app.calls[0].messages.at(-1), { role: "user", content: text });
    assert.deepEqual(await usage(), [{ day: "2026-10-28", requests: 1 }]);
  });
}

test("successful translations consume exactly one reservation and return the expected contract", async (t) => {
  const app = await cloudServer(t, { storage });
  const { status, body } = await app.translate();
  assert.deepEqual({ status, body }, {
    status: 200, body: { sourceText: "こんにちは", translatedText: "Hello." },
  });
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].max_completion_tokens, 1200);
  assert.deepEqual(await usage(), [{ day: "2026-10-28", requests: 1 }]);
});

for (const scenario of [
  {
    label: "successful translation",
    status: 200,
    body: { sourceText: "こんにちは", translatedText: "Hello." },
    providerCalls: 1,
  },
  {
    label: "invalid dialogue",
    options: { text: " \t\u3000" },
    status: 400,
    body: { error: "Enter between 1 and 2000 characters of dialogue." },
    providerCalls: 0,
  },
  {
    label: "missing consent",
    options: { consent: null },
    status: 400,
    body: { error: "Choose cloud translation and accept its privacy prompt first." },
    providerCalls: 0,
  },
  {
    label: "exhausted allowance",
    exhausted: true,
    status: 429,
    body: { error: "Today’s free cloud allowance is used up. Please use offline translation." },
    providerCalls: 0,
  },
  {
    label: "provider failure",
    provider: async () => { throw new SyntheticProviderError(500); },
    status: 503,
    body: { error: "Cloud translation is temporarily unavailable. Please use offline translation." },
    providerCalls: 1,
  },
]) {
  test(`cloud responses forbid caching for ${scenario.label}`, async (t) => {
    // Seed quota directly: no bursts, rate-limit timing, or concurrent requests.
    if (scenario.exhausted) {
      await storage.pool.query(
        "INSERT INTO kotoba_cloud_usage (day, requests) VALUES ('2026-10-28', 3)",
      );
    }
    const app = await cloudServer(t, { storage, provider: scenario.provider });
    const { status, body, headers } = await app.translate(scenario.options);
    assert.equal(status, scenario.status);
    assert.deepEqual(body, scenario.body);
    assert.equal(headers.get("cache-control"), "no-store");
    assert.equal(app.calls.length, scenario.providerCalls);
  });
}

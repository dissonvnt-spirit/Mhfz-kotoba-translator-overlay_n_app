import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { archiveServer, archiveStorage, validArchive } from "./helpers/archive-fixture.mjs";

let storage;
before(async () => { storage = await archiveStorage(); });
after(async () => { await storage?.close(); });
beforeEach(async () => {
  await storage.pool.query("TRUNCATE dialogue_archives, dialogue_archive_usage");
});
const size = Buffer.byteLength(JSON.stringify(validArchive.lines));
async function seed(uploads, bytes = uploads * size, day = "today") {
  await storage.pool.query(`INSERT INTO dialogue_archive_usage VALUES
    ('global', (date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      - CASE WHEN $3 = 'yesterday' THEN interval '24 hours' ELSE interval '0' END, $1, $2)`,
  [uploads, bytes, day]);
}
async function usage() {
  return (await storage.pool.query("SELECT uploads, bytes FROM dialogue_archive_usage")).rows;
}
function noStore(result) {
  assert.match(result.headers.get("cache-control"), /no-store/);
  assert.equal(result.headers.get("pragma"), "no-cache");
}

test("independent instances and a restarted instance cannot bypass the shared count allowance", async (t) => {
  await seed(97);
  const apps = await Promise.all(Array.from({ length: 12 }, () => archiveServer(t, storage, { independentPool: true })));
  const results = await Promise.all(apps.map((app) => app()));
  assert.equal(results.filter((r) => r.status === 201).length, 3);
  assert.equal(results.filter((r) => r.status === 429).length, 9);
  for (const result of results) {
    noStore(result);
    if (result.status === 429) {
      assert.ok(Number(result.headers.get("retry-after")) >= 1);
      assert.ok(Number(result.headers.get("retry-after")) <= 86400);
    }
  }
  const restarted = await archiveServer(t, storage, { independentPool: true });
  assert.equal((await restarted()).status, 429);
  assert.deepEqual(await usage(), [{ uploads: 100, bytes: 100 * size }]);
  assert.equal((await storage.pool.query("SELECT count(*)::int AS count FROM dialogue_archives")).rows[0].count, 3);
});

test("competing uploads initialize empty shared storage without losing reservations", async (t) => {
  const apps = await Promise.all(Array.from({ length: 8 }, () => archiveServer(t, storage, { independentPool: true })));
  const results = await Promise.all(apps.map((app) => app()));
  assert.ok(results.every((r) => r.status === 201));
  assert.deepEqual(await usage(), [{ uploads: 8, bytes: 8 * size }]);
});

test("shared bytes allow the exact boundary, then block even with spare upload slots", async (t) => {
  await seed(0, 16 * 1024 * 1024 - size);
  const apps = await Promise.all(Array.from({ length: 6 }, () => archiveServer(t, storage)));
  const results = await Promise.all(apps.map((app) => app()));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 429).length, 5);
  assert.deepEqual(await usage(), [{ uploads: 1, bytes: 16 * 1024 * 1024 }]);
});

test("database UTC day rollover resets the single bounded allowance row", async (t) => {
  await seed(100, 16 * 1024 * 1024, "yesterday");
  const app = await archiveServer(t, storage);
  assert.equal((await app()).status, 201);
  assert.deepEqual(await usage(), [{ uploads: 1, bytes: size }]);
});

test("deduplication and stored-byte accounting use the exact saved dialogue", async (t) => {
  const app = await archiveServer(t, storage);
  const result = await app({ body: { ...validArchive, lines: [...validArchive.lines, ...validArchive.lines] } });
  assert.equal(result.status, 201);
  assert.equal(result.body.lineCount, 1);
  assert.deepEqual(await usage(), [{ uploads: 1, bytes: size }]);
});

test("consent and parser failures never consume persistent allowance", async (t) => {
  const app = await archiveServer(t, storage);
  for (const options of [
    { body: { ...validArchive, consent: false } },
    { body: { ...validArchive, consent: undefined } },
    { body: { ...validArchive, lines: [] } },
    { body: { ...validArchive, title: " " } },
    { rawBody: "{" },
    { rawBody: JSON.stringify({ padding: "x".repeat(1024 * 1024) }) },
  ]) {
    const result = await app(options);
    assert.ok([400, 413].includes(result.status));
    noStore(result);
    assert.deepEqual(await usage(), []);
  }
});

test("recovery codes remain hashed, retrieval is private, and deletion does not refund uploads", async (t) => {
  const app = await archiveServer(t, storage);
  const receipt = await app();
  noStore(receipt);
  assert.equal(receipt.status, 201);
  const code = receipt.body.recoveryCode;
  assert.match(code, /^[a-f0-9]{64}$/);
  const stored = (await storage.pool.query("SELECT * FROM dialogue_archives")).rows[0];
  assert.equal(stored.code_hash, createHash("sha256").update(code).digest("hex"));
  assert.ok(!JSON.stringify(stored).includes(code));
  for (const method of ["GET", "DELETE"]) {
    const denied = await app({ method });
    assert.equal(denied.status, 401);
    noStore(denied);
  }
  assert.equal((await app({ method: "GET", code: "a".repeat(64) })).status, 404);
  const found = await app({ method: "GET", code });
  assert.deepEqual(found.body.lines, validArchive.lines);
  noStore(found);
  assert.equal((await app({ method: "DELETE", code })).status, 204);
  assert.equal((await app({ method: "GET", code })).status, 404);
  assert.deepEqual(await usage(), [{ uploads: 1, bytes: size }]);
});

test("storage cap checks still reject uploads without consuming daily allowance", async (t) => {
  const app = await archiveServer(t, storage);
  for (const [count, bytes] of [[1, 512 * 1024 * 1024], [10_000, 0]]) {
    await storage.pool.query("TRUNCATE dialogue_archives");
    await storage.pool.query(`INSERT INTO dialogue_archives
      SELECT md5(i::text), 'synthetic', '[]'::jsonb, $2, now()
      FROM generate_series(1, $1::int) i`, [count, bytes]);
    const full = await app();
    assert.equal(full.status, 503);
    noStore(full);
    assert.deepEqual(await usage(), []);
  }
});

test("archive insert failure rolls back its allowance reservation and does not expose dialogue", async (t) => {
  const app = await archiveServer(t, storage);
  await storage.pool.query("ALTER TABLE dialogue_archives ADD CONSTRAINT synthetic_failure CHECK (size_bytes = 0)");
  try {
    const result = await app();
    assert.equal(result.status, 503);
    noStore(result);
    assert.doesNotMatch(JSON.stringify(result.body), /テスト|Synthetic dialogue|synthetic_failure/);
    assert.deepEqual(await usage(), []);
  } finally {
    await storage.pool.query("ALTER TABLE dialogue_archives DROP CONSTRAINT synthetic_failure");
  }
  assert.equal((await app()).status, 201);
});

test("missing allowance storage fails closed without saving any archive", async (t) => {
  const app = await archiveServer(t, storage);
  await storage.pool.query("ALTER TABLE dialogue_archive_usage RENAME TO hidden_archive_usage");
  try {
    const result = await app();
    assert.equal(result.status, 503);
    noStore(result);
    assert.equal((await storage.pool.query("SELECT count(*)::int AS count FROM dialogue_archives")).rows[0].count, 0);
  } finally {
    await storage.pool.query("ALTER TABLE hidden_archive_usage RENAME TO dialogue_archive_usage");
  }
});

test("held database lock returns a bounded 503 without saving or reserving", async (t) => {
  const app = await archiveServer(t, storage);
  const blocker = await storage.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT pg_advisory_xact_lock(728194601)");
  try {
    const start = performance.now();
    const result = await app();
    assert.equal(result.status, 503);
    assert.ok(performance.now() - start < 4500);
    noStore(result);
    assert.deepEqual(await usage(), []);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  assert.equal((await app()).status, 201);
});

test("exhausted archive connection pool returns a bounded 503", async (t) => {
  const app = await archiveServer(t, storage);
  const clients = await Promise.all(Array.from({ length: 4 }, () => storage.dialogueArchivePool.connect()));
  try {
    const start = performance.now();
    const result = await app();
    assert.equal(result.status, 503);
    assert.ok(performance.now() - start < 4500);
    noStore(result);
    assert.deepEqual(await usage(), []);
  } finally {
    clients.forEach((client) => client.release());
  }
  assert.equal((await app()).status, 201);
});

test("a locked allowance row cannot leave an archive saved without a reservation", async (t) => {
  await seed(1);
  const app = await archiveServer(t, storage);
  const blocker = await storage.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT * FROM dialogue_archive_usage FOR UPDATE");
  try {
    const start = performance.now();
    const result = await app();
    assert.equal(result.status, 503);
    assert.ok(performance.now() - start < 4500);
    assert.deepEqual(await usage(), [{ uploads: 1, bytes: size }]);
    assert.equal((await storage.pool.query("SELECT count(*)::int AS count FROM dialogue_archives")).rows[0].count, 0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});

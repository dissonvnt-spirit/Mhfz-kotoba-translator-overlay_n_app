import { createHash, randomBytes } from "node:crypto";
import express, { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { eq, sql } from "drizzle-orm";
import { db, dialogueArchivesTable } from "@workspace/db";
import { CreateDialogueArchiveBody } from "@workspace/api-zod";

const router: IRouter = Router();
const MAX_STORAGE_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVES = 10_000;
const hash = (code: string) => createHash("sha256").update(code).digest("hex");
const uploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false });
const readLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });

router.use("/dialogue-archives", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  next();
});

router.post("/dialogue-archives", uploadLimit, express.json({ limit: "1mb" }), async (req, res) => {
  const input = CreateDialogueArchiveBody.safeParse(req.body);
  if (!input.success || input.data.consent !== true ||
      !input.data.title.trim() || input.data.lines.some((line) => !line.sourceText.trim() || !line.translatedText.trim())) {
    res.status(400).json({ error: "Provide a title, explicit archive consent, and 1–500 valid dialogue entries." });
    return;
  }
  const unique = new Map(input.data.lines.map((line) => [JSON.stringify([line.timestamp, line.sourceText, line.translatedText]), line]));
  const lines = [...unique.values()].sort((a, b) => b.timestamp - a.timestamp);
  const sizeBytes = Buffer.byteLength(JSON.stringify(lines), "utf8");
  const recoveryCode = randomBytes(32).toString("hex");
  try {
    const saved = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
      // Serialize capacity checks across processes; never silently exceed the storage cap.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(728194601)`);
      const [usage] = await tx.select({
        bytes: sql<number>`coalesce(sum(${dialogueArchivesTable.sizeBytes}), 0)::bigint`,
        count: sql<number>`count(*)::integer`,
      }).from(dialogueArchivesTable);
      if (Number(usage.bytes) + sizeBytes > MAX_STORAGE_BYTES || usage.count >= MAX_ARCHIVES) return false;
      await tx.insert(dialogueArchivesTable).values({
        codeHash: hash(recoveryCode), title: input.data.title.trim(), lines, sizeBytes,
      });
      return true;
    });
    if (!saved) {
      res.status(503).json({ error: "Archive storage is full. Keep your local backup and try again later." });
      return;
    }
    res.status(201).json({ recoveryCode, lineCount: lines.length });
  } catch {
    req.log.warn("Dialogue archive storage unavailable");
    res.status(503).json({ error: "Archive could not be saved. Keep your local backup and retry later." });
  }
});

router.use("/dialogue-archives", readLimit, (req, res, next) => {
  if (req.method !== "GET" && req.method !== "DELETE") { next(); return; }
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(req.get("Authorization") || "");
  if (!match) {
    res.status(401).json({ error: "Provide the private 64-character recovery code." });
    return;
  }
  res.locals.archiveHash = hash(match[1].toLowerCase());
  next();
});

router.get("/dialogue-archives", async (req, res) => {
  try {
    const [archive] = await db.select({
      title: dialogueArchivesTable.title, lines: dialogueArchivesTable.lines, createdAt: dialogueArchivesTable.createdAt,
    }).from(dialogueArchivesTable).where(eq(dialogueArchivesTable.codeHash, res.locals.archiveHash)).limit(1);
    if (!archive) { res.status(404).json({ error: "Archive not found. Check the recovery code and service address." }); return; }
    res.json({ ...archive, createdAt: archive.createdAt.toISOString() });
  } catch {
    req.log.warn("Dialogue archive retrieval unavailable");
    res.status(503).json({ error: "Archive could not be retrieved. Try again later." });
  }
});

router.delete("/dialogue-archives", async (req, res) => {
  try {
    await db.delete(dialogueArchivesTable).where(eq(dialogueArchivesTable.codeHash, res.locals.archiveHash));
    res.status(204).end();
  } catch {
    req.log.warn("Dialogue archive deletion unavailable");
    res.status(503).json({ error: "Archive could not be deleted. Try again later." });
  }
});

export default router;

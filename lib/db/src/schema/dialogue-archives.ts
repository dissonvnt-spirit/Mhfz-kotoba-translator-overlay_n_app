import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type ArchivedDialogueLine = { sourceText: string; translatedText: string; timestamp: number };

export const dialogueArchivesTable = pgTable("dialogue_archives", {
  codeHash: text("code_hash").primaryKey(),
  title: text("title").notNull(),
  lines: jsonb("lines").$type<ArchivedDialogueLine[]>().notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertDialogueArchiveSchema = createInsertSchema(dialogueArchivesTable).omit({ createdAt: true });
export type InsertDialogueArchive = z.infer<typeof insertDialogueArchiveSchema>;
export type DialogueArchive = typeof dialogueArchivesTable.$inferSelect;

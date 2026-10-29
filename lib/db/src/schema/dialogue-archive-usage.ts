import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One bounded row, not an ever-growing history of clients or their addresses.
export const dialogueArchiveUsageTable = pgTable("dialogue_archive_usage", {
  scope: text("scope").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  uploads: integer("uploads").notNull(),
  bytes: integer("bytes").notNull(),
}, (table) => [
  check("dialogue_archive_usage_global", sql`${table.scope} = 'global'`),
  check("dialogue_archive_usage_nonnegative", sql`${table.uploads} >= 0 AND ${table.bytes} >= 0`),
]);

export const insertDialogueArchiveUsageSchema = createInsertSchema(dialogueArchiveUsageTable);
export type InsertDialogueArchiveUsage = z.infer<typeof insertDialogueArchiveUsageSchema>;
export type DialogueArchiveUsage = typeof dialogueArchiveUsageTable.$inferSelect;

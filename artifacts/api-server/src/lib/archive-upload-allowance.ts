import { sql } from "drizzle-orm";
import { dialogueArchiveUsageTable } from "@workspace/db";

// Deliberately independent of cloud translation spending. A successful upload
// consumes allowance even if the archive is subsequently deleted.
export const ARCHIVE_DAILY_UPLOADS = 100;
export const ARCHIVE_DAILY_BYTES = 16 * 1024 * 1024;

// Use the database clock and UTC, not a process clock or session timezone.
export const archiveDay = sql`date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
export const archiveRetrySeconds = sql<number>`greatest(1, ceil(extract(epoch FROM (
  (${archiveDay} + interval '24 hours') - clock_timestamp()
))))::integer`;

export function reserveArchiveUpload(sizeBytes: number) {
  return sql`
    INSERT INTO ${dialogueArchiveUsageTable} (scope, window_start, uploads, bytes)
    VALUES ('global', ${archiveDay}, 1, ${sizeBytes})
    ON CONFLICT (scope) DO UPDATE SET
      window_start = EXCLUDED.window_start,
      uploads = CASE WHEN ${dialogueArchiveUsageTable.windowStart} < EXCLUDED.window_start
        THEN 1 ELSE ${dialogueArchiveUsageTable.uploads} + 1 END,
      bytes = CASE WHEN ${dialogueArchiveUsageTable.windowStart} < EXCLUDED.window_start
        THEN EXCLUDED.bytes ELSE ${dialogueArchiveUsageTable.bytes} + EXCLUDED.bytes END
    WHERE ${dialogueArchiveUsageTable.windowStart} < EXCLUDED.window_start
      OR (${dialogueArchiveUsageTable.uploads} < ${ARCHIVE_DAILY_UPLOADS}
        AND ${dialogueArchiveUsageTable.bytes} + EXCLUDED.bytes <= ${ARCHIVE_DAILY_BYTES})
    RETURNING scope
  `;
}

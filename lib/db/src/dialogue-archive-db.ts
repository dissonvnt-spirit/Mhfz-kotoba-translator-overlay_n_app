import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// Isolate archive contention from translation traffic. connectionTimeoutMillis
// bounds both pool acquisition and connection establishment; SET LOCAL in the
// upload transaction bounds SQL/lock waits after acquisition.
export const dialogueArchivePool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 2_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 5_000,
  lock_timeout: 2_000,
});
export const dialogueArchiveDb = drizzle(dialogueArchivePool, { schema });

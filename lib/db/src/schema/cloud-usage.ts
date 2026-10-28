import { date, integer, pgTable } from 'drizzle-orm/pg-core';

// Aggregate counts only. No dialogue, IP addresses, or player identifiers.
export const cloudUsageTable = pgTable('kotoba_cloud_usage', {
  day: date('day').primaryKey(),
  requests: integer('requests').notNull().default(0),
});

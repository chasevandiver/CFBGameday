/**
 * Preflight for the backup job: describe SUPABASE_DB_URL, then get out of the
 * way. Exits 1 on a verdict pg_dump cannot recover from, so the run fails at
 * the line that explains it rather than on Postgres's ambiguous auth error.
 *
 * Prints no secret material — see scripts/lib/db-url.ts.
 *
 * Usage: npx tsx scripts/check-db-url.ts
 */

import { describeDbUrl } from "./lib/db-url";

const r = describeDbUrl(process.env.SUPABASE_DB_URL);
console.log(`conn: ${r.summary}`);

if (r.verdict === "error") {
  console.log(`::error::SUPABASE_DB_URL — ${r.problem}`);
  process.exit(1);
}
if (r.verdict === "warn") {
  console.log(`::warning::SUPABASE_DB_URL — ${r.problem}`);
}

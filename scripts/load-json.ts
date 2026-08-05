/**
 * Load a JSON array of row objects into a table via the service role.
 * Usage: npx tsx scripts/load-json.ts <file.json> <table> [--conflict cols]
 */

import { readFile } from "node:fs/promises";
import { createServiceClient } from "../src/lib/supabase/service";

async function main() {
  const [file, table] = process.argv.slice(2);
  if (!file || !table) throw new Error("usage: load-json.ts <file.json> <table> [--conflict cols]");
  const conflictArg = process.argv.indexOf("--conflict");
  const onConflict = conflictArg > -1 ? process.argv[conflictArg + 1] : undefined;

  const rows = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>[];
  const db = createServiceClient();

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = onConflict
      ? await db.from(table).upsert(batch, { onConflict })
      : await db.from(table).upsert(batch);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`${rows.length} rows → ${table}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

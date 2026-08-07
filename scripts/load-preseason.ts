/**
 * Load a `build-preseason.ts --out DIR` directory into Postgres.
 *
 * `load-json.ts` loads one file into one table. That is fine by hand, but the
 * preseason build emits nine tables with foreign keys between them, and two of
 * those tables are append-only — so "load every file in the directory" is a
 * correctness question, not a for-loop.
 *
 * ## Order
 *
 * `build-preseason.ts` emits in dependency order and prefixes each file with a
 * running counter (`01-seasons-0.json`, `02-teams-0.json`, …), so counter order
 * IS foreign-key order. This script sorts on that counter numerically and
 * trusts it, rather than hard-coding a table list that would silently skip a
 * table added to the build later.
 *
 * ## Append-only tables
 *
 * `predictions` and `line_snapshots` have identity primary keys. An upsert
 * cannot match an existing row, so re-running the load appends a second full
 * copy — the same duplicate-batch failure the freeze job's date horizon was
 * added to prevent (see docs/CHANGELOG.md). They are skipped by default and
 * only loaded under `--bootstrap`, which is the once-per-season first load.
 *
 * A refresh — the common case, and the reason this script exists — updates the
 * reference and rating tables in place and leaves the frozen receipts alone.
 * `predictions` rows are history: the Thursday freeze job writes the ones that
 * matter, and rewriting a frozen row would defeat the point of freezing it.
 *
 * ## Once the season starts
 *
 * A preseason rebuild writes week-0 `ratings`. After a single game is final
 * those are no longer the current ratings — the Sunday `ratings-update` job
 * owns them — and re-loading a preseason build would quietly reset the season
 * to its starting state. The load refuses on a season with completed games
 * unless `--force`.
 *
 * Usage:
 *   npx tsx scripts/load-preseason.ts --dir .preseason-json
 *   npx tsx scripts/load-preseason.ts --dir .preseason-json --bootstrap
 *   npx tsx scripts/load-preseason.ts --dir .preseason-json --dry-run
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../src/lib/supabase/service";
import { SEASON } from "./lib/ingest";

/** Identity-PK tables: an upsert appends rather than replaces. */
export const APPEND_ONLY = new Set(["predictions", "line_snapshots"]);

const CHUNK = 500;

/** `07-team_hfa-0.json` → `team_hfa`. Null for anything not emitted by the build. */
export function tableOf(filename: string): string | null {
  const m = /^\d+-([a-z_]+)-\d+\.json$/.exec(path.basename(filename));
  return m ? m[1] : null;
}

/** The emit counter: `07-team_hfa-0.json` → 7. */
function emitSeq(filename: string): number {
  const m = /^(\d+)-/.exec(path.basename(filename));
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

export interface PlannedFile {
  file: string;
  table: string;
  skipped: "append_only" | null;
}

/**
 * Decide what gets loaded, in what order, before touching the database — so a
 * --dry-run and the real run agree by construction.
 */
export function planLoad(filenames: string[], bootstrap: boolean): PlannedFile[] {
  return filenames
    .filter((f) => f.endsWith(".json"))
    // Sort on the counter as a NUMBER, not on the string. build-preseason pads
    // to two digits, so a season with 100+ chunk files would sort "100" before
    // "99" and load a child table ahead of its parent. That is one bowl season
    // away from real: games and line_snapshots already emit four files each.
    .sort((a, b) => emitSeq(a) - emitSeq(b) || a.localeCompare(b))
    .map((file) => ({ file, table: tableOf(file) }))
    .filter((x): x is { file: string; table: string } => x.table !== null)
    .map(({ file, table }) => ({
      file,
      table,
      skipped: !bootstrap && APPEND_ONLY.has(table) ? ("append_only" as const) : null,
    }));
}

/**
 * Has a game in this season already been played? A preseason build describes
 * week 0; once results exist, week-0 ratings are history and the current ones
 * come from ratings-update.
 */
export async function seasonHasStarted(db: SupabaseClient, season: number): Promise<boolean> {
  const { data, error } = await db
    .from("games")
    .select("id")
    .eq("season_id", season)
    .eq("status", "final")
    .limit(1);
  if (error) throw new Error(`season start check: ${error.message}`);
  return (data ?? []).length > 0;
}

async function main() {
  const dirArg = process.argv.indexOf("--dir");
  const dir = dirArg > -1 ? process.argv[dirArg + 1] : ".preseason-json";
  const bootstrap = process.argv.includes("--bootstrap");
  const dryRun = process.argv.includes("--dry-run");

  const plan = planLoad(await readdir(dir), bootstrap);
  if (plan.length === 0) throw new Error(`no preseason JSON files in ${dir}`);

  console.log(
    `${plan.length} file(s) in ${dir} · mode=${bootstrap ? "bootstrap" : "refresh"}` +
      `${dryRun ? " · DRY RUN" : ""}`,
  );

  const db = dryRun ? null : createServiceClient();

  if (db && !process.argv.includes("--force") && (await seasonHasStarted(db, SEASON))) {
    console.log(
      `${SEASON} already has final games — refusing to load a preseason build over a season ` +
        `in progress. Week-0 ratings are history now; ratings-update owns the current ones. ` +
        `Pass --force if you genuinely mean to reset.`,
    );
    process.exitCode = 1;
    return;
  }

  let loaded = 0;

  for (const { file, table, skipped } of plan) {
    const rows = JSON.parse(await readFile(path.join(dir, file), "utf8")) as Record<
      string,
      unknown
    >[];

    if (skipped) {
      console.log(`  skip  ${file} → ${table} (${rows.length} rows) — append-only, use --bootstrap`);
      continue;
    }
    if (!db) {
      console.log(`  would ${file} → ${table} (${rows.length} rows)`);
      continue;
    }

    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK));
      if (error) throw new Error(`${table} (${file}): ${error.message}`);
    }
    loaded += rows.length;
    console.log(`  load  ${file} → ${table} (${rows.length} rows)`);
  }

  console.log(dryRun ? "Dry run — nothing written." : `Done: ${loaded} rows loaded.`);
}

// Only run when invoked as a script — `planLoad` and `tableOf` are exported for
// unit tests, and importing this file must not start writing to the database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

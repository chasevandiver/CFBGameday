import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../../src/lib/supabase/service";
import { envNum } from "./env-num";

/** Season being ingested — env-overridable so the site rolls to 2027 without
 *  a code hunt (audit #13: 2026 was hardcoded in a dozen places). */
export const SEASON = envNum("CFB_SEASON", 2026, { min: 2000, max: 2100 });

export function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

/** In dry-run mode, log intended writes instead of touching the database. */
export interface Sink {
  upsert(table: string, rows: object[], onConflict?: string): Promise<void>;
  insert(table: string, rows: object[]): Promise<void>;
}

export function createSink(): { sink: Sink; db: SupabaseClient | null } {
  if (isDryRun()) {
    const sink: Sink = {
      async upsert(table, rows) {
        console.log(`[dry-run] upsert ${rows.length} rows → ${table}`);
      },
      async insert(table, rows) {
        console.log(`[dry-run] insert ${rows.length} rows → ${table}`);
      },
    };
    return { sink, db: null };
  }

  const db = createServiceClient();
  const sink: Sink = {
    async upsert(table, rows, onConflict) {
      if (rows.length === 0) return;
      const { error } = await db.from(table).upsert(rows, onConflict ? { onConflict } : undefined);
      if (error) throw new Error(`upsert ${table}: ${error.message}`);
    },
    async insert(table, rows) {
      if (rows.length === 0) return;
      const { error } = await db.from(table).insert(rows);
      if (error) throw new Error(`insert ${table}: ${error.message}`);
    },
  };
  return { sink, db };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

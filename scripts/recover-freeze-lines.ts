/**
 * FREEZE-3 — recover the market line on frozen receipts the freeze could not see.
 *
 *   npx tsx scripts/recover-freeze-lines.ts            # dry run: prints what it would write
 *   npx tsx scripts/recover-freeze-lines.ts --apply    # writes, and stamps the marker
 *
 * Targets every frozen prediction for the current CFB season with
 * `vegas_spread` null, rebuilds the freeze-time consensus from the snapshots
 * captured before the row's `created_at`, and writes the market fields only
 * (`src/lib/freeze-recovery.ts` says exactly which, and why the model's own
 * number is never touched). Rows whose snapshot log has no pre-freeze spread
 * either are reported and left alone — those genuinely had no line.
 *
 * Idempotent: a recovered row has `vegas_spread` set and drops out of the
 * target set, so a second run finds nothing.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: `predictions` is
 * append-only for users and only the service role may update it.
 */

import { createClient } from "@supabase/supabase-js";
import { SNAPSHOT_COLS, type SnapshotLike } from "../src/lib/consensus";
import { LINE_RECOVERED_KEY, recoverFreezeLine, type LineRecoveredMarker } from "../src/lib/freeze-recovery";
import { pageAll } from "../src/lib/page-all";

const apply = process.argv.includes("--apply");

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

interface Target {
  id: number;
  game_id: number;
  spread: number | string;
  created_at: string;
  close_spread: number | string | null;
  adjustments: Record<string, unknown> | null;
  games: { week: number } | null;
}

async function main() {
  const { data: season, error: seasonErr } = await db
    .from("seasons")
    .select("id")
    .eq("is_current", true)
    .eq("sport", "cfb")
    .maybeSingle();
  if (seasonErr || !season) throw new Error(`current season: ${seasonErr?.message ?? "none"}`);

  const targets = await pageAll<Target>((from, to) =>
    db
      .from("predictions")
      .select("id, game_id, spread, created_at, close_spread, adjustments, games(week)")
      .eq("frozen", true)
      .eq("season_id", season.id)
      .is("vegas_spread", null)
      .order("id")
      .range(from, to),
  );
  console.log(`${targets.length} frozen receipts with no market line in ${season.id}`);
  if (targets.length === 0) return;

  const gameIds = [...new Set(targets.map((t) => t.game_id))];
  const snapsByGame = new Map<number, SnapshotLike[]>();
  for (let i = 0; i < gameIds.length; i += 300) {
    const rows = await pageAll<SnapshotLike & { game_id: number }>((from, to) =>
      db
        .from("line_snapshots")
        .select(SNAPSHOT_COLS)
        .in("game_id", gameIds.slice(i, i + 300))
        .order("id")
        .range(from, to),
    );
    for (const s of rows) {
      const arr = snapsByGame.get(s.game_id) ?? [];
      arr.push(s);
      snapsByGame.set(s.game_id, arr);
    }
  }

  const marker: LineRecoveredMarker = {
    at: new Date().toISOString(),
    reason: "FREEZE-3",
    from: "line_snapshots",
  };
  let recovered = 0;
  let unlined = 0;
  for (const t of targets) {
    const line = recoverFreezeLine({
      modelSpread: Number(t.spread),
      week: t.games?.week ?? 1,
      frozenAt: t.created_at,
      closeSpread: t.close_spread === null ? null : Number(t.close_spread),
      snapshots: snapsByGame.get(t.game_id) ?? [],
    });
    if (line === null) {
      unlined += 1;
      console.log(`  ${t.game_id}: no pre-freeze spread in the log — left unlined`);
      continue;
    }
    recovered += 1;
    console.log(
      `  ${t.game_id}: model ${t.spread} · market ${line.vegas_spread} (open ${line.open_spread}) · edge ${line.edge} ${line.edge_flag ?? ""}` +
        (line.clv === null ? "" : ` · clv ${line.clv}`),
    );
    if (!apply) continue;
    const { error } = await db
      .from("predictions")
      .update({
        ...line,
        adjustments: { ...(t.adjustments ?? {}), [LINE_RECOVERED_KEY]: marker },
      })
      .eq("id", t.id);
    if (error) throw new Error(`update ${t.id}: ${error.message}`);
  }
  console.log(`${recovered} recovered, ${unlined} genuinely unlined${apply ? "" : " (dry run — pass --apply to write)"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

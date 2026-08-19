/**
 * `verify-preseason` — read back what the load actually wrote.
 *
 * See `scripts/lib/preseason-verify.ts` for why this exists. Read-only, no CFBD
 * calls, a handful of counting queries. Exits 1 with the problems named.
 *
 *   npx tsx scripts/verify-preseason.ts
 */

import { createServiceClient } from "../src/lib/supabase/service";
import { MODEL_VERSION } from "../src/model/ratings";
import { preseasonVerdict, type PreseasonState } from "./lib/preseason-verify";

async function readState(): Promise<PreseasonState> {
  const db = createServiceClient();

  const { data: season, error: seasonErr } = await db
    .from("seasons")
    .select("id")
    .eq("is_current", true)
    .eq("sport", "cfb")
    .single();
  if (seasonErr || !season) throw new Error(`no current cfb season: ${seasonErr?.message}`);
  const seasonId = (season as { id: number }).id;

  const { data: ratingRows, error: ratingErr } = await db
    .from("ratings")
    .select("team_id, overall, offense, defense, model_version")
    .eq("season_id", seasonId)
    .eq("week", 0);
  if (ratingErr) throw new Error(`ratings read failed: ${ratingErr.message}`);
  const ratings = (ratingRows ?? []) as {
    team_id: number;
    overall: number;
    offense: number;
    defense: number;
    model_version: string;
  }[];

  const { data: hfaRows } = await db.from("team_hfa").select("team_id, blended_hfa");
  const hfa = (hfaRows ?? []) as { team_id: number; blended_hfa: number }[];

  const { data: compRows } = await db
    .from("preseason_components")
    .select("team_id, final_prev_rating, detail")
    .eq("season_id", seasonId);
  const comps = (compRows ?? []) as {
    team_id: number;
    final_prev_rating: number | null;
    detail: { talent_stale?: boolean } | null;
  }[];

  /* Chained from last season's OWN board rather than from a team list: the
     question is "did we rate this team a year ago", and only the ratings table
     answers it. A team that was FCS last season is legitimately absent here and
     legitimately has no prior to chain from. */
  const { data: prevRows } = await db
    .from("ratings")
    .select("team_id")
    .eq("season_id", seasonId - 1)
    .eq("week", 0);
  const ratedLastSeason = new Set(((prevRows ?? []) as { team_id: number }[]).map((r) => r.team_id));
  const chainBreaks = comps.filter(
    (c) => ratedLastSeason.has(c.team_id) && c.final_prev_rating === null,
  ).length;

  const { count: finals } = await db
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("season_id", seasonId)
    .eq("status", "final");

  return {
    seasonId,
    ratings: ratings.length,
    versions: [...new Set(ratings.map((r) => r.model_version))].sort(),
    expectedVersion: MODEL_VERSION,
    hfaRows: hfa.length,
    distinctBlendedHfa: new Set(hfa.map((h) => Number(h.blended_hfa))).size,
    components: comps.length,
    staleTalentRows: comps.filter((c) => c.detail?.talent_stale === true).length,
    /* 0.011, not 1e-6. `build-preseason` asserts the halves sum to within 1e-9
       BEFORE rounding, then stores all three columns at two decimals — so
       overall −3.15 with offense −1.58 stores defense −1.58 and the sum is
       −3.16. At 1e-6 that reads as 64 of 138 rows broken; the arithmetic is
       fine and the tolerance was measuring the storage format. Two roundings of
       up to 0.005 each is 0.01, so 0.011 admits the rounding and nothing
       larger. */
    halvesMismatched: ratings.filter(
      (r) => Math.abs(Number(r.offense) + Number(r.defense) - Number(r.overall)) > 0.011,
    ).length,
    chainBreaks,
    prevBoard: ratedLastSeason.size,
    finals: finals ?? 0,
  };
}

async function main() {
  const state = await readState();

  console.log(`== verify-preseason == season ${state.seasonId}`);
  console.log(`  week-0 ratings        ${state.ratings}`);
  console.log(`  model_version         ${state.versions.join(", ") || "none"} (code: ${state.expectedVersion})`);
  console.log(`  team_hfa rows         ${state.hfaRows}  (${state.distinctBlendedHfa} distinct blended_hfa)`);
  console.log(`  preseason_components  ${state.components}  (${state.staleTalentRows} talent_stale)`);
  console.log(`  halves mismatched     ${state.halvesMismatched}`);
  console.log(
    `  chain breaks          ${state.chainBreaks}` +
      (state.prevBoard === 0 ? "  (unevaluable — no prior-season board)" : ` of ${state.prevBoard} chainable`),
  );
  console.log(`  games already final   ${state.finals}`);

  const { problems, notices } = preseasonVerdict(state);

  console.log("");
  for (const n of notices) console.log(`::notice::verify-preseason: ${n}`);

  if (problems.length === 0) {
    console.log(
      notices.length > 0
        ? "\n→ the load landed: every invariant that COULD be checked holds. See the notices above."
        : "\n→ the load landed: every post-load invariant holds.",
    );
    return;
  }
  for (const p of problems) console.log(`::error::verify-preseason: ${p}`);
  console.log(
    `\n→ ${problems.length} problem(s). This is the check that "Done: N rows loaded" cannot make.`,
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

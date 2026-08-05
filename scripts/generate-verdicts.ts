/**
 * Generate "The Verdict" for every rated FBS team (docs/SPEC.md §3.10):
 * ceiling, floor, the one swing factor, and a market note — grounded in the
 * model's own numbers (rating, rank, preseason components, priced schedule).
 * Idempotent: skips teams that already have a verdict unless --force.
 *
 * Usage: npx tsx --env-file=.env.local scripts/generate-verdicts.ts \
 *          [--force] [--only <school substring>] [--limit N]
 */

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createAnthropic, LLM_MODEL } from "../src/lib/anthropic";
import { createServiceClient } from "../src/lib/supabase/service";
import {
  DEFAULT_PARAMS,
  priceGame,
  type TeamRating,
} from "../src/model/ratings";
import { SEASON } from "./lib/ingest";

const VerdictSchema = z.object({
  ceiling: z.string(),
  floor: z.string(),
  swing_factor: z.string(),
  market_note: z.string(),
});

const SYSTEM = `You are the editorial voice of The CFB Slate, a college football site for a small friend group that tracks its own power ratings and picks. You write short, blunt, specific verdicts — no hype boilerplate, no hedging every sentence, no "only time will tell". Ground every claim in the numbers you are given. One to two sentences per field.

Fields:
- ceiling: the best realistic version of this season and what record/finish that looks like.
- floor: the realistic bad outcome, not the apocalypse.
- swing_factor: the ONE thing that decides which of those happens.
- market_note: where our model's number likely disagrees with public perception of this team, and which side you'd lean.`;

interface TeamCtx {
  id: number;
  school: string;
  conference: string | null;
  rating: number;
  rank: number;
  components: string;
  schedule: string;
  projected: string;
}

function fmt(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
}

async function main() {
  const force = process.argv.includes("--force");
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg > -1 ? process.argv[onlyArg + 1].toLowerCase() : null;
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const db = createServiceClient();
  const anthropic = createAnthropic();

  const [teamsRes, ratingsRes, compsRes, hfaRes, gamesRes, existingRes] = await Promise.all([
    db.from("teams").select("id, school, conference"),
    db
      .from("ratings")
      .select("team_id, week, overall")
      .eq("season_id", SEASON)
      .order("week", { ascending: false }),
    db
      .from("preseason_components")
      .select(
        "team_id, final_prev_rating, talent_baseline, churn_adjustment, coaching_adjustment, luck_correction",
      )
      .eq("season_id", SEASON),
    db.from("team_hfa").select("team_id, blended_hfa"),
    db.from("games").select("*").eq("season_id", SEASON).order("start_ts"),
    db.from("team_verdicts").select("team_id").eq("season_id", SEASON),
  ]);
  for (const res of [teamsRes, ratingsRes, compsRes, hfaRes, gamesRes, existingRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const teams = new Map(
    (teamsRes.data ?? []).map((t) => [t.id as number, t as { id: number; school: string; conference: string | null }]),
  );
  const latest = new Map<number, number>();
  for (const r of ratingsRes.data ?? []) {
    if (!latest.has(r.team_id)) latest.set(r.team_id, Number(r.overall));
  }
  const ranked = [...latest.entries()].sort((a, b) => b[1] - a[1]);
  const rankOf = new Map(ranked.map(([id], i) => [id, i + 1]));
  const comps = new Map((compsRes.data ?? []).map((c) => [c.team_id as number, c]));
  const hfa = new Map((hfaRes.data ?? []).map((h) => [h.team_id as number, Number(h.blended_hfa)]));
  const done = new Set((existingRes.data ?? []).map((v) => v.team_id as number));

  const toRating = (overall: number | undefined): TeamRating => ({
    overall: overall ?? -30,
    offense: (overall ?? -30) / 2,
    defense: (overall ?? -30) / 2,
    tempo: 70,
  });

  const targets: TeamCtx[] = [];
  for (const [teamId, rating] of ranked) {
    const team = teams.get(teamId);
    if (!team) continue;
    if (only && !team.school.toLowerCase().includes(only)) continue;
    if (!force && done.has(teamId)) continue;

    const games = (gamesRes.data ?? []).filter(
      (g) => g.home_team_id === teamId || g.away_team_id === teamId,
    );
    let expWins = 0;
    const lines = games.map((g) => {
      const isHome = g.home_team_id === teamId;
      const oppId = isHome ? g.away_team_id : g.home_team_id;
      const opp = teams.get(oppId);
      const price = priceGame(
        {
          home: toRating(latest.get(g.home_team_id)),
          away: toRating(latest.get(g.away_team_id)),
          homeTeamHfa: hfa.get(g.home_team_id) ?? DEFAULT_PARAMS.baseHfa,
          neutralSite: g.neutral_site,
          situationalPoints: 0,
          vegasSpread: null,
        },
        DEFAULT_PARAMS,
      );
      const winProb = isHome ? price.homeWinProb : 1 - price.homeWinProb;
      expWins += winProb;
      const oppRank = rankOf.get(oppId);
      return `wk${g.week} ${g.neutral_site ? "vs" : isHome ? "vs" : "at"} ${opp?.school ?? "TBD"}${oppRank ? ` (#${oppRank})` : " (FCS)"} — win prob ${Math.round(winProb * 100)}%`;
    });

    const c = comps.get(teamId);
    const components = c
      ? `2025 base ${fmt(Number(c.final_prev_rating ?? 0))}, talent ${fmt(Number(c.talent_baseline ?? 0))}, roster churn ${fmt(Number(c.churn_adjustment ?? 0))}, coaching ${fmt(Number(c.coaching_adjustment ?? 0))}, luck correction ${fmt(Number(c.luck_correction ?? 0))}`
      : "n/a";

    targets.push({
      id: teamId,
      school: team.school,
      conference: team.conference,
      rating,
      rank: rankOf.get(teamId) ?? 0,
      components,
      schedule: lines.join("\n"),
      projected: `${expWins.toFixed(1)}–${(games.length - expWins).toFixed(1)}`,
    });
    if (targets.length >= limit) break;
  }

  console.log(`${targets.length} teams to generate (model ${LLM_MODEL})`);

  let ok = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (t) => {
        const prompt = `Team: ${t.school} (${t.conference ?? "Independent"}), ${SEASON} preseason.
Our power rating: ${fmt(t.rating)} points vs an average FBS team (rank #${t.rank} of ${ranked.length}).
Rating components: ${t.components}.
Projected record from our priced schedule: ${t.projected}.
Schedule (our win probability per game):
${t.schedule}

Write the verdict for ${t.school}.`;

        try {
          const response = await anthropic.messages.parse({
            model: LLM_MODEL,
            max_tokens: 1000,
            system: SYSTEM,
            messages: [{ role: "user", content: prompt }],
            output_config: { format: zodOutputFormat(VerdictSchema) },
          });
          const verdict = response.parsed_output;
          if (!verdict) throw new Error("no parsed output");
          const { error } = await db.from("team_verdicts").upsert(
            {
              season_id: SEASON,
              team_id: t.id,
              verdict,
              model: LLM_MODEL,
              generated_at: new Date().toISOString(),
            },
            { onConflict: "season_id,team_id" },
          );
          if (error) throw new Error(error.message);
          ok += 1;
          console.log(`  ✓ ${t.school}`);
        } catch (err) {
          console.error(`  ✗ ${t.school}: ${err instanceof Error ? err.message : err}`);
        }
      }),
    );
  }
  console.log(`${ok}/${targets.length} verdicts written`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

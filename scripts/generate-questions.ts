/**
 * Generate "Three Questions" for every game in the upcoming week that has a
 * frozen prediction (docs/SPEC.md §6.6): the three swing factors that decide
 * the game, grounded in the frozen model numbers and the current market.
 * Idempotent: skips games that already have questions unless --force.
 *
 * Usage: npx tsx --env-file=.env.local scripts/generate-questions.ts \
 *          [--force] [--week N] [--limit N]
 */

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createAnthropic, LLM_MODEL } from "../src/lib/anthropic";
import type { GameRow, LineSnapshotRow, PredictionRow } from "../src/lib/db-types";
import { consensusFromSnapshots } from "../src/lib/queries";
import { createServiceClient } from "../src/lib/supabase/service";
import { SEASON } from "./lib/ingest";

const QuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        why_it_matters: z.string(),
      }),
    )
    .length(3),
});

const SYSTEM = `You are the editorial voice of The CFB Slate, a college football site for a small friend group that tracks its own power ratings and picks. For each matchup, write the THREE questions that actually decide the game — specific to these two teams and these numbers, never generic ("can they establish the run?" is banned unless you say for whom and why it swings THIS spread). One sentence per question, one to two sentences for why it matters. If our model and the market disagree, at least one question should probe that disagreement.`;

function fmtSpread(n: number | null): string {
  if (n === null) return "n/a";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
}

async function main() {
  const force = process.argv.includes("--force");
  const weekArg = process.argv.indexOf("--week");
  let week = weekArg > -1 ? Number(process.argv[weekArg + 1]) : undefined;
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const db = createServiceClient();
  const anthropic = createAnthropic();

  if (week === undefined) {
    const { data, error } = await db
      .from("games")
      .select("week")
      .eq("season_id", SEASON)
      .eq("status", "scheduled")
      .order("week")
      .limit(1);
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("no scheduled games — pass --week");
    week = data[0].week as number;
  }

  const { data: gameRows, error: gamesErr } = await db
    .from("games")
    .select("*")
    .eq("season_id", SEASON)
    .eq("week", week)
    .order("start_ts");
  if (gamesErr) throw new Error(gamesErr.message);
  const games = (gameRows ?? []) as GameRow[];
  const gameIds = games.map((g) => g.id);

  const [teamsRes, predsRes, linesRes, ratingsRes, existingRes] = await Promise.all([
    db.from("teams").select("id, school, conference"),
    db
      .from("predictions")
      .select("*")
      .in("game_id", gameIds)
      .eq("frozen", true)
      .order("created_at", { ascending: false }),
    db.from("line_snapshots").select("*").in("game_id", gameIds),
    db
      .from("ratings")
      .select("team_id, week, overall")
      .eq("season_id", SEASON)
      .order("week", { ascending: false }),
    db.from("game_questions").select("game_id").in("game_id", gameIds),
  ]);
  for (const res of [teamsRes, predsRes, linesRes, ratingsRes, existingRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const teams = new Map(
    (teamsRes.data ?? []).map((t) => [t.id as number, t as { id: number; school: string; conference: string | null }]),
  );
  const predByGame = new Map<number, PredictionRow>();
  for (const p of (predsRes.data ?? []) as PredictionRow[]) {
    if (!predByGame.has(p.game_id)) predByGame.set(p.game_id, p); // newest first
  }
  const snapsByGame = new Map<number, LineSnapshotRow[]>();
  for (const s of (linesRes.data ?? []) as LineSnapshotRow[]) {
    const arr = snapsByGame.get(s.game_id) ?? [];
    arr.push(s);
    snapsByGame.set(s.game_id, arr);
  }
  const latest = new Map<number, number>();
  for (const r of ratingsRes.data ?? []) {
    if (!latest.has(r.team_id)) latest.set(r.team_id, Number(r.overall));
  }
  const done = new Set((existingRes.data ?? []).map((q) => q.game_id as number));

  const targets = games
    .filter((g) => predByGame.has(g.id) && (force || !done.has(g.id)))
    .slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(`week ${week}: ${targets.length} games to generate (model ${LLM_MODEL})`);

  let ok = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (g) => {
        const home = teams.get(g.home_team_id);
        const away = teams.get(g.away_team_id);
        const pred = predByGame.get(g.id);
        if (!home || !away || !pred) return;
        const consensus = consensusFromSnapshots(snapsByGame.get(g.id) ?? []);
        const label = `${away.school} at ${home.school}`;

        const prompt = `Matchup: ${label}${g.neutral_site ? " (neutral site)" : ""}, ${SEASON} week ${g.week}.
Power ratings (points vs average FBS): ${home.school} ${fmtSpread(latest.get(g.home_team_id) ?? null)}, ${away.school} ${fmtSpread(latest.get(g.away_team_id) ?? null)}.
Our frozen model line: ${home.school} ${fmtSpread(Number(pred.spread))}, home win probability ${Math.round(Number(pred.home_win_prob) * 100)}%${pred.total !== null ? `, model total ${Number(pred.total).toFixed(1)}` : ""}.
Market consensus: spread ${home.school} ${fmtSpread(consensus.spread)}${consensus.total !== null ? `, total ${consensus.total.toFixed(1)}` : ""}${consensus.open !== null ? ` (opened ${fmtSpread(consensus.open)})` : ""}.
Model edge vs market: ${pred.edge !== null ? `${fmtSpread(Number(pred.edge))} points${pred.edge_flag ? ` (${pred.edge_flag})` : ""}` : "n/a"}.

Write the three questions that decide ${label}.`;

        try {
          const response = await anthropic.messages.parse({
            model: LLM_MODEL,
            max_tokens: 1200,
            system: SYSTEM,
            messages: [{ role: "user", content: prompt }],
            output_config: { format: zodOutputFormat(QuestionsSchema) },
          });
          const parsed = response.parsed_output;
          if (!parsed) throw new Error("no parsed output");
          const { error } = await db.from("game_questions").upsert(
            {
              game_id: g.id,
              questions: parsed.questions,
              model: LLM_MODEL,
              generated_at: new Date().toISOString(),
            },
            { onConflict: "game_id" },
          );
          if (error) throw new Error(error.message);
          ok += 1;
          console.log(`  ✓ ${label}`);
        } catch (err) {
          console.error(`  ✗ ${label}: ${err instanceof Error ? err.message : err}`);
        }
      }),
    );
  }
  console.log(`${ok}/${targets.length} question sets written`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * The Tuesday Drop (R2-B2): one LLM-written paragraph defending the week's
 * most controversial model position, plus a headline. Runs Monday 15:00 UTC
 * after Sunday's ratings-update; the hub features it Tuesday.
 *
 * Mirrors generate-verdicts.ts: service client, zod-parsed output, idempotent
 * per (season, week) unless --force. The arithmetic lives pure in
 * scripts/lib/drop.ts.
 *
 * Skip guards, loudly and by design: fewer than two ratings weeks (nothing to
 * move), or nothing defensible to argue. A drop written over stale or empty
 * ratings is worse than no drop — the upstream failure should be the visible
 * event, not a paragraph confidently defending last week.
 *
 * Usage: npx tsx --env-file=.env.local scripts/generate-drop.ts [--force]
 */

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createAnthropic, LLM_MODEL } from "../src/lib/anthropic";
import { pickPollRanks } from "../src/lib/rankings";
import { createServiceClient } from "../src/lib/supabase/service";
import {
  dissents,
  modelRanks,
  pickSubject,
  topMovers,
  weekPair,
  type DropPollRow,
  type DropRatingRow,
} from "./lib/drop";
import { SEASON } from "./lib/ingest";

const DropSchema = z.object({
  headline: z.string(),
  defense: z.string(),
});

const SYSTEM = `You are the voice of The Slate's weekly ratings drop — a private football site whose crew argues with its own model every Tuesday. You write ONE headline (under 12 words, no colon constructions) and ONE defense paragraph (3-5 sentences). Blunt, specific, grounded ONLY in the numbers given. Defend the model's position like you mean it, but never invent a stat. No hype boilerplate, no "only time will tell", no betting advice.`;

const fmt = (n: number): string => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

async function main() {
  const force = process.argv.includes("--force");
  const db = createServiceClient();

  const [ratingsRes, pollRes, teamsRes] = await Promise.all([
    db.from("ratings").select("team_id, week, overall").eq("season_id", SEASON),
    db
      .from("poll_rankings")
      .select("team_id, rank, poll, week, season_type")
      .eq("season_id", SEASON),
    db.from("teams").select("id, school"),
  ]);
  for (const res of [ratingsRes, pollRes, teamsRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const ratings = (ratingsRes.data ?? []) as DropRatingRow[];
  const pair = weekPair(ratings);
  if (!pair) {
    console.log("drop: fewer than two ratings weeks — nothing has moved yet, skipping");
    return;
  }

  const { data: existing } = await db
    .from("rating_drops")
    .select("week")
    .eq("season_id", SEASON)
    .eq("week", pair.week)
    .maybeSingle();
  if (existing && !force) {
    console.log(`drop: week ${pair.week} already written — use --force to regenerate`);
    return;
  }

  const movers = topMovers(ratings, pair.week, pair.prev);
  const ranks = modelRanks(ratings, pair.week);
  const { poll, byTeam } = pickPollRanks(
    (pollRes.data ?? []) as Array<{
      team_id: number;
      rank: number;
      poll: string;
      week: number;
      season_type: string;
    }>,
  );
  const pollRows: DropPollRow[] = [...byTeam.entries()].map(([team_id, rank]) => ({
    team_id,
    rank,
  }));
  const diss = dissents(ranks, pollRows);
  const subject = pickSubject(movers, diss);
  if (!subject) {
    console.log("drop: nothing defensible to argue this week, skipping");
    return;
  }

  const name = new Map(
    ((teamsRes.data ?? []) as Array<{ id: number; school: string }>).map((t) => [t.id, t.school]),
  );
  const moverLines = movers
    .map((m) => `${name.get(m.teamId) ?? m.teamId}: ${fmt(m.delta)} to ${fmt(m.overall)}`)
    .join("\n");
  const dissLines = diss
    .slice(0, 6)
    .map(
      (d) =>
        `${name.get(d.teamId) ?? d.teamId}: ${poll ?? "poll"} #${d.pollRank}, our #${d.modelRank} (gap ${d.gap > 0 ? "+" : ""}${d.gap})`,
    )
    .join("\n");
  const subjectLine =
    subject.kind === "dissent"
      ? `THE ARGUMENT: ${name.get(subject.d.teamId) ?? subject.d.teamId} — the ${poll ?? "poll"} has them #${subject.d.pollRank}, our ratings say #${subject.d.modelRank}. Defend our number.`
      : `THE ARGUMENT: ${name.get(subject.m.teamId) ?? subject.m.teamId} just moved ${fmt(subject.m.delta)} in one week, more than anyone. Defend the move.`;

  const prompt = `Week ${pair.week} ratings drop, ${SEASON} season.

Biggest movers this week (rating delta, new rating — points vs an average FBS team):
${moverLines || "none"}

Where our ratings disagree with the ${poll ?? "human poll"} (biggest gaps):
${dissLines || "no poll published yet"}

${subjectLine}`;

  const anthropic = createAnthropic();
  const response = await anthropic.messages.parse({
    model: LLM_MODEL,
    max_tokens: 600,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(DropSchema) },
  });
  const content = response.parsed_output;
  if (!content) throw new Error("no parsed output");

  const { error } = await db.from("rating_drops").upsert(
    {
      season_id: SEASON,
      week: pair.week,
      content,
      model: LLM_MODEL,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "season_id,week" },
  );
  if (error) throw new Error(error.message);
  console.log(`✓ drop written for week ${pair.week}: "${content.headline}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

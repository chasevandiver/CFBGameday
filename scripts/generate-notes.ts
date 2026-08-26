/**
 * Pregame notes (F3b): 0–3 game-scoped notes for every CFB game in the next
 * 7 days, grounded ONLY in what we already store — the F3 headlines and the
 * model's own numbers. Discovery stayed free (scripts/lib/team-news.ts); this
 * is the cheap classification half: kilobytes of stored text per game, no web
 * search, ~pennies a day at the SPEC's model for the editorial layer.
 *
 * Regenerates the window every run on purpose — news changes daily, and
 * yesterday's note on today's QB announcement is the staleness F3 exists to
 * kill. Upsert per game, so a re-run costs tokens and never duplicates.
 *
 * Usage: npx tsx --env-file=.env.local scripts/generate-notes.ts \
 *          [--only <school substring>] [--limit N]
 */

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createAnthropic, LLM_MODEL } from "../src/lib/anthropic";
import type { GameRow, LineSnapshotRow, TeamNewsRow } from "../src/lib/db-types";
import { pickPollRanks } from "../src/lib/rankings";
import { consensusFromSnapshots } from "../src/lib/queries";
import { createServiceClient } from "../src/lib/supabase/service";
import { buildNotesPrompt, selectNewsForPrompt, type NotesTeamCtx } from "./lib/notes";
import { SEASON } from "./lib/ingest";

const NotesSchema = z.object({
  notes: z
    .array(
      z.object({
        kind: z.enum(["availability", "coaching", "roster", "market", "context"]),
        note: z.string(),
      }),
    )
    .max(3),
});

const SYSTEM = `You are the editorial voice of The CFB Slate, a college football site for a small friend group that tracks its own power ratings and picks. For each matchup you get the model's stored numbers and the week's stored team headlines. Write the pregame notes that would change how a reader handicaps THIS game: a QB named, hurt, suspended or banned; a coaching change; a roster exodus the poll or market has not priced; a poll-vs-model gap the given numbers explain.

Hard rules:
- ZERO notes is the normal case. Most games have none. Never manufacture relevance, and never restate the spread as a note.
- Ground every claim in a supplied headline or number. Your own memory of teams and players is stale — if it is not in the input, it does not go in a note.
- One to two blunt sentences per note. Name the player or coach when a headline does.
- kind: availability (who plays), coaching (who coaches), roster (who left or arrived), market (poll/market vs our number), context (anything else that clears the bar).`;

async function main() {
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg > -1 ? process.argv[onlyArg + 1].toLowerCase() : null;
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const db = createServiceClient();
  const anthropic = createAnthropic();

  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  const { data: gameRows, error: gamesErr } = await db
    .from("games")
    .select("*")
    .eq("season_id", SEASON)
    .eq("status", "scheduled")
    .gt("start_ts", now.toISOString())
    .lte("start_ts", horizon)
    .order("start_ts");
  if (gamesErr) throw new Error(gamesErr.message);
  const games = (gameRows ?? []) as GameRow[];
  const gameIds = games.map((g) => g.id);
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];

  const [teamsRes, ratingsRes, pollsRes, compsRes, predsRes, linesRes, newsRes] =
    await Promise.all([
      db.from("teams").select("id, school").in("id", teamIds),
      db.from("latest_ratings").select("team_id, overall").eq("season_id", SEASON),
      db
        .from("latest_poll_rankings")
        .select("week, poll, team_id, rank")
        .eq("season_id", SEASON)
        .eq("season_type", "regular"),
      db
        .from("preseason_components")
        .select("team_id, churn_adjustment, coaching_adjustment")
        .eq("season_id", SEASON)
        .in("team_id", teamIds),
      db
        .from("predictions")
        .select("game_id, spread, created_at")
        .in("game_id", gameIds)
        .eq("frozen", true)
        .order("created_at", { ascending: false }),
      db.from("line_snapshots").select("*").in("game_id", gameIds),
      db.from("team_news").select("*").in("team_id", teamIds),
    ]);
  for (const res of [teamsRes, ratingsRes, pollsRes, compsRes, predsRes, linesRes, newsRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const school = new Map((teamsRes.data ?? []).map((t) => [t.id as number, t.school as string]));
  const rating = new Map(
    (ratingsRes.data ?? []).map((r) => [r.team_id as number, Number(r.overall)]),
  );
  const modelRank = new Map(
    [...rating.entries()].sort((a, b) => b[1] - a[1]).map(([teamId], i) => [teamId, i + 1]),
  );
  const { byTeam: pollRanks } = pickPollRanks(
    (pollsRes.data ?? []) as Array<{ week: number; poll: string; team_id: number; rank: number }>,
  );
  const comps = new Map(
    (compsRes.data ?? []).map((c) => [
      c.team_id as number,
      {
        churn: c.churn_adjustment === null ? null : Number(c.churn_adjustment),
        coaching: c.coaching_adjustment === null ? null : Number(c.coaching_adjustment),
      },
    ]),
  );
  const spreadByGame = new Map<number, number>();
  for (const p of predsRes.data ?? []) {
    if (!spreadByGame.has(p.game_id)) spreadByGame.set(p.game_id, Number(p.spread)); // newest first
  }
  const snapsByGame = new Map<number, LineSnapshotRow[]>();
  for (const s of (linesRes.data ?? []) as LineSnapshotRow[]) {
    const arr = snapsByGame.get(s.game_id) ?? [];
    arr.push(s);
    snapsByGame.set(s.game_id, arr);
  }
  const news = (newsRes.data ?? []) as TeamNewsRow[];

  const teamCtx = (teamId: number): NotesTeamCtx => ({
    school: school.get(teamId) ?? `team ${teamId}`,
    rating: rating.get(teamId) ?? null,
    modelRank: modelRank.get(teamId) ?? null,
    pollRank: pollRanks.get(teamId) ?? null,
    churn: comps.get(teamId)?.churn ?? null,
    coaching: comps.get(teamId)?.coaching ?? null,
  });

  const targets = games
    .filter(
      (g) =>
        only === null ||
        school.get(g.home_team_id)?.toLowerCase().includes(only) ||
        school.get(g.away_team_id)?.toLowerCase().includes(only),
    )
    .slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(`${targets.length} games in the window (model ${LLM_MODEL})`);

  let ok = 0;
  let withNotes = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (g) => {
        const label = `${school.get(g.away_team_id)} at ${school.get(g.home_team_id)}`;
        const prompt = buildNotesPrompt(
          {
            label,
            week: g.week,
            neutralSite: g.neutral_site,
            home: teamCtx(g.home_team_id),
            away: teamCtx(g.away_team_id),
            modelSpread: spreadByGame.get(g.id) ?? null,
            marketSpread: consensusFromSnapshots(snapsByGame.get(g.id) ?? []).spread,
          },
          selectNewsForPrompt(news, g.home_team_id, now),
          selectNewsForPrompt(news, g.away_team_id, now),
          SEASON,
        );
        try {
          const response = await anthropic.messages.parse({
            model: LLM_MODEL,
            max_tokens: 1000,
            system: SYSTEM,
            messages: [{ role: "user", content: prompt }],
            output_config: { format: zodOutputFormat(NotesSchema) },
          });
          const parsed = response.parsed_output;
          if (!parsed) throw new Error("no parsed output");
          const { error } = await db.from("game_notes").upsert(
            {
              game_id: g.id,
              notes: parsed.notes,
              model: LLM_MODEL,
              generated_at: new Date().toISOString(),
            },
            { onConflict: "game_id" },
          );
          if (error) throw new Error(error.message);
          ok += 1;
          if (parsed.notes.length > 0) withNotes += 1;
          console.log(`  ✓ ${label} (${parsed.notes.length} note${parsed.notes.length === 1 ? "" : "s"})`);
        } catch (err) {
          console.error(`  ✗ ${label}: ${err instanceof Error ? err.message : err}`);
        }
      }),
    );
  }
  console.log(`${ok}/${targets.length} games written, ${withNotes} with notes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

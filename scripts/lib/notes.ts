/**
 * Pregame notes (F3b) — deterministic, by owner call: no standing API spend.
 * The LLM version of this producer lived one dispatch and never wrote a row
 * (the key gate skipped it); both cases that motivated the feature turned out
 * to be derivable from rows we already store, so the rules do it for free:
 *
 * - availability/roster/coaching: a stored headline whose text matches a
 *   pattern that changes who plays, who coaches, or who's on the roster.
 *   The note IS the headline — nothing is generated, so nothing can be
 *   hallucinated. A pattern can false-positive onto a tagged NFL story;
 *   that surfaces a real headline verbatim, which is noise, not fiction.
 *   ("retires" is deliberately absent: the one retirement in the live feed
 *   was an NFL alum story tagged to his college.)
 * - market: the poll and our model disagree about a team by enough spots
 *   that the game reads differently — printed with the churn/coaching
 *   preseason components when they are the visible cause (the "still ranked
 *   despite the exodus" case, which needs all three numbers in one line).
 *
 * Thresholds here are display-layer editorial cuts, not model parameters —
 * nothing feeds back into ratings or lines, so the model gate does not
 * apply. They are named constants so the next argument about them has an
 * address.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameRow, TeamNewsRow } from "../../src/lib/db-types";
import { pickPollRanks } from "../../src/lib/rankings";
import { SEASON } from "./ingest";

type Json = Record<string, unknown>;

export interface GameNote {
  kind: "availability" | "coaching" | "roster" | "market";
  note: string;
}

/** Poll-vs-model gap (in rank spots) before the disagreement is a note. */
export const MARKET_GAP = 12;
/** Model rank at or above which being poll-unranked is itself the note. */
export const UNRANKED_MODEL_RANK = 10;
/** Component size (points) worth naming as the cause of a market note. */
export const COMPONENT_FLOOR = 1;
/** At most this many notes per game; availability outranks market. */
export const MAX_NOTES = 3;

const HEADLINE_RULES: Array<{ kind: GameNote["kind"]; re: RegExp }> = [
  // Who plays. QB naming is the loudest single fact in a pregame read.
  { kind: "availability", re: /\bqb1\b/i },
  { kind: "availability", re: /starting quarterback|to start at (quarterback|qb)\b/i },
  { kind: "availability", re: /names .* (as )?(the )?starter\b/i },
  { kind: "availability", re: /\bfor (the )?season\b/i }, // "out/loses X for season"
  { kind: "availability", re: /season[- ]ending/i },
  { kind: "availability", re: /suspend|dismiss|banned|ruled out|arrested|charged/i },
  { kind: "availability", re: /\binjur/i },
  // Who's on the roster.
  { kind: "roster", re: /transfer portal|enters? the portal/i },
  // Who coaches.
  { kind: "coaching", re: /head[- ]coach|interim coach|coaching change/i },
];

interface HeadlineNote extends GameNote {
  publishedAt: string;
}

/**
 * Headlines that clear a rule, newest first, one note per article. The note
 * text is "<School>: <headline>" — attribution plus the source's own words.
 */
export function headlineNotes(
  news: TeamNewsRow[],
  teamId: number,
  school: string,
  now: Date,
  maxAgeDays = 7,
): HeadlineNote[] {
  const cutoff = now.getTime() - maxAgeDays * 24 * 3600 * 1000;
  return news
    .filter((r) => r.team_id === teamId && Date.parse(r.published_at) >= cutoff)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .flatMap((r) => {
      const rule = HEADLINE_RULES.find((h) => h.re.test(r.headline));
      if (!rule) return [];
      return [{ kind: rule.kind, note: `${school}: ${r.headline}`, publishedAt: r.published_at }];
    });
}

export interface MarketTeamCtx {
  school: string;
  modelRank: number | null;
  pollRank: number | null;
  churn: number | null;
  coaching: number | null;
}

const pts = (n: number): string => Math.abs(n).toFixed(1);

/**
 * The poll-vs-model disagreement, when it is big enough to read differently
 * — with the preseason components printed when they are the visible cause.
 */
export function marketNote(t: MarketTeamCtx): GameNote | null {
  if (t.modelRank === null) return null;
  const reasons: string[] = [];
  if (t.churn !== null && t.churn <= -COMPONENT_FLOOR)
    reasons.push(`${pts(t.churn)} pts of roster churn`);
  if (t.coaching !== null && t.coaching <= -COMPONENT_FLOOR)
    reasons.push(`${pts(t.coaching)} for the coaching change`);
  const because = reasons.length > 0 ? ` — the preseason build already docks ${reasons.join(" and ")}` : "";

  if (t.pollRank !== null && t.modelRank - t.pollRank >= MARKET_GAP) {
    return {
      kind: "market",
      note: `${t.school} is #${t.pollRank} in the poll but #${t.modelRank} in our model${because}.`,
    };
  }
  if (t.pollRank !== null && t.pollRank - t.modelRank >= MARKET_GAP) {
    return {
      kind: "market",
      note: `Our model has ${t.school} #${t.modelRank}, well ahead of their #${t.pollRank} poll rank.`,
    };
  }
  if (t.pollRank === null && t.modelRank <= UNRANKED_MODEL_RANK) {
    return {
      kind: "market",
      note: `${t.school} is unranked in the polls, but our model has them #${t.modelRank}.`,
    };
  }
  return null;
}

/**
 * One game's notes: matched headlines from both teams (newest first), then
 * market notes, capped at MAX_NOTES. Zero is the normal case.
 */
export function notesForGame(
  headline: HeadlineNote[],
  home: MarketTeamCtx,
  away: MarketTeamCtx,
): GameNote[] {
  const fromHeadlines: GameNote[] = [...headline]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .map(({ kind, note }) => ({ kind, note }));
  const fromMarket = [marketNote(away), marketNote(home)].filter((n): n is GameNote => n !== null);
  return [...fromHeadlines, ...fromMarket].slice(0, MAX_NOTES);
}

/** Stamped into game_notes.model so a row says which rules wrote it. */
export const NOTES_RULES_VERSION = "rules-v1";

/**
 * The daily producer: every CFB game in the next 7 days gets its notes row
 * (an empty list included — overwriting is what keeps a Tuesday note from
 * surviving a Thursday dismissal). No external calls at all: everything is
 * read back out of our own tables.
 */
export async function gameNotesJob(db: SupabaseClient): Promise<Json> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  const { data: gameRows, error: gamesErr } = await db
    .from("games")
    .select("*")
    .eq("season_id", SEASON)
    .eq("status", "scheduled")
    .gt("start_ts", now.toISOString())
    .lte("start_ts", horizon);
  if (gamesErr) throw new Error(gamesErr.message);
  const games = (gameRows ?? []) as GameRow[];
  if (games.length === 0) return { games: 0, withNotes: 0 };
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];

  const [teamsRes, ratingsRes, pollsRes, compsRes, newsRes] = await Promise.all([
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
    db.from("team_news").select("*").in("team_id", teamIds),
  ]);
  for (const res of [teamsRes, ratingsRes, pollsRes, compsRes, newsRes]) {
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
  const news = (newsRes.data ?? []) as TeamNewsRow[];

  const marketCtx = (teamId: number): MarketTeamCtx => ({
    school: school.get(teamId) ?? `team ${teamId}`,
    modelRank: modelRank.get(teamId) ?? null,
    pollRank: pollRanks.get(teamId) ?? null,
    churn: comps.get(teamId)?.churn ?? null,
    coaching: comps.get(teamId)?.coaching ?? null,
  });

  let withNotes = 0;
  for (const g of games) {
    const notes = notesForGame(
      [
        ...headlineNotes(news, g.home_team_id, school.get(g.home_team_id) ?? "", now),
        ...headlineNotes(news, g.away_team_id, school.get(g.away_team_id) ?? "", now),
      ],
      marketCtx(g.home_team_id),
      marketCtx(g.away_team_id),
    );
    const { error } = await db.from("game_notes").upsert(
      {
        game_id: g.id,
        notes,
        model: NOTES_RULES_VERSION,
        generated_at: now.toISOString(),
      },
      { onConflict: "game_id" },
    );
    if (error) throw new Error(error.message);
    if (notes.length > 0) withNotes += 1;
  }
  return { games: games.length, withNotes };
}

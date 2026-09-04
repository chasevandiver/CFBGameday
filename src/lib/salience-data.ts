/**
 * SAL-1's reads. `salience.ts` stays pure; this is the half that touches the
 * database.
 *
 * ## Who calls this
 *
 * The daily-puzzle generator, once per run — not a page. Building the deck
 * means reading eleven seasons of games, polls and closing lines, which is far
 * too much for a request and exactly right for a job that runs at 09:00 and
 * banks two weeks of puzzles. Guess the Game computed its selection on read,
 * and GTG-1 is the cost of that: no cadence, no watchdog lane, and an empty
 * deck that nobody noticed for weeks.
 *
 * ## Pagination is not optional here
 *
 * PostgREST caps a response at 1000 rows. A CFB season is ~870 regular-season
 * games plus bowls, which is under the cap and would work — right up until it
 * quietly did not. The line snapshots are already several thousand rows a
 * season. `cfbDeck`'s comment learned this lesson once
 * (`guess-game-data.ts`): a silently truncated deck is a deck that still
 * works, which is the kind of bug nobody finds. So every read here pages
 * explicitly and asserts nothing about how many rows a season has.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { consensusFromSnapshots, type SnapshotLike } from "./consensus";
import { pageAll } from "./page-all";
import { NFL_ID_OFFSET } from "./league";
import { pollRanksByWeek, pollWeeks } from "./rankings";
import { rankBySalience, type SalienceGame } from "./salience";

export interface DeckGame {
  id: number;
  seasonId: number;
  week: number;
  seasonType: string;
  startTs: string | null;
  homeTeamId: number;
  awayTeamId: number;
  homePoints: number;
  awayPoints: number;
  /** Conference AT KICKOFF (migration 0067). Null = unknown; not today's. */
  homeConference: string | null;
  awayConference: string | null;
  neutralSite: boolean;
  conferenceGame: boolean;
  venueId: number | null;
  notes: string | null;
  /** Closing spread, home perspective. Null when the archive has no market. */
  spread: number | null;
  total: number | null;
  /** True when a poll was PUBLISHED that week — not the same as "ranked". */
  pollPublished: boolean;
  homeRank: number | null;
  awayRank: number | null;
  salience: SalienceGame;
}

interface GameRow {
  id: number;
  season_id: number;
  week: number;
  season_type: string;
  start_ts: string | null;
  home_team_id: number;
  away_team_id: number;
  home_points: number;
  away_points: number;
  home_conference: string | null;
  away_conference: string | null;
  neutral_site: boolean;
  conference_game: boolean;
  venue_id: number | null;
  notes: string | null;
}

const GAME_COLS =
  "id, season_id, week, season_type, start_ts, home_team_id, away_team_id, " +
  "home_points, away_points, home_conference, away_conference, neutral_site, " +
  "conference_game, venue_id, notes";

/** Which CFB seasons exist, oldest first. Discovered, never declared — GTG-1. */
export async function cfbSeasons(db: SupabaseClient): Promise<number[]> {
  const { data, error } = await db
    .from("seasons")
    .select("id")
    .eq("sport", "cfb")
    .lt("id", NFL_ID_OFFSET)
    .order("id");
  if (error) throw new Error(`salience: seasons read failed: ${error.message}`);
  return ((data ?? []) as Array<{ id: number }>).map((s) => s.id);
}

/** Rivalry pairs, as an unordered-pair key set plus the trophy for each. */
export async function fetchRivalries(
  db: SupabaseClient,
): Promise<Map<string, string | null>> {
  const { data, error } = await db.from("rivalries").select("team_a_id, team_b_id, trophy");
  if (error) throw new Error(`salience: rivalries read failed: ${error.message}`);
  const out = new Map<string, string | null>();
  for (const r of (data ?? []) as Array<{
    team_a_id: number;
    team_b_id: number;
    trophy: string | null;
  }>) {
    out.set(pairKey(r.team_a_id, r.team_b_id), r.trophy);
  }
  return out;
}

/** Order-independent, so it matches whichever side hosted. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * One season's games, scored.
 *
 * Finals with a score only — a game with no score cannot answer a question
 * about itself, which is the same filter `cfbDeck` applies and for the same
 * reason. Postseason is INCLUDED here, unlike Guess the Game's deck: bowls and
 * championship games are among the most memorable games in the archive, and
 * excluding them was a side effect of that deck's `season_type = 'regular'`
 * filter rather than a decision.
 */
export async function fetchSeasonDeck(
  db: SupabaseClient,
  seasonId: number,
  rivalries: Map<string, string | null>,
): Promise<DeckGame[]> {
  const games = await pageAll<GameRow>((from, to) =>
    db
      .from("games")
      .select(GAME_COLS)
      .eq("season_id", seasonId)
      .eq("status", "final")
      .not("home_points", "is", null)
      .not("away_points", "is", null)
      .order("id")
      .range(from, to),
  );
  if (games.length === 0) return [];

  const [polls, snapshots] = await Promise.all([
    pageAll<{ season_id: number; week: number; poll: string; team_id: number; rank: number }>(
      (from, to) =>
        db
          .from("poll_rankings")
          .select("season_id, week, poll, team_id, rank")
          .eq("season_id", seasonId)
          .order("team_id")
          .range(from, to),
    ),
    fetchSeasonSnapshots(db, games),
  ]);

  const ranks = pollRanksByWeek(polls);
  const weeksWithPolls = pollWeeks(polls);

  return games.map((g) => {
    /* The closing line is the last snapshot BEFORE kickoff — the same rule
       every other reader uses, through the same function, so the archive and
       the live season cannot disagree about what "closing" means. */
    const snaps = snapshots.get(g.id) ?? [];
    const closing =
      g.start_ts === null || snaps.length === 0
        ? { spread: null, total: null }
        : consensusFromSnapshots(snaps, g.start_ts);

    const pollPublished = weeksWithPolls.has(`${g.season_id}:${g.week}`);
    const homeRank = ranks.get(`${g.season_id}:${g.week}:${g.home_team_id}`) ?? null;
    const awayRank = ranks.get(`${g.season_id}:${g.week}:${g.away_team_id}`) ?? null;
    const trophy = rivalries.get(pairKey(g.home_team_id, g.away_team_id));

    return {
      id: g.id,
      seasonId: g.season_id,
      week: g.week,
      seasonType: g.season_type,
      startTs: g.start_ts,
      homeTeamId: g.home_team_id,
      awayTeamId: g.away_team_id,
      homePoints: g.home_points,
      awayPoints: g.away_points,
      homeConference: g.home_conference,
      awayConference: g.away_conference,
      neutralSite: g.neutral_site,
      conferenceGame: g.conference_game,
      venueId: g.venue_id,
      notes: g.notes,
      spread: closing.spread,
      total: closing.total,
      pollPublished,
      homeRank,
      awayRank,
      salience: {
        homePoints: g.home_points,
        awayPoints: g.away_points,
        homeRank,
        awayRank,
        spread: closing.spread,
        isRivalry: trophy !== undefined,
        trophy: trophy ?? null,
        seasonType: g.season_type,
        notes: g.notes,
        neutralSite: g.neutral_site,
      },
    };
  });
}

/**
 * A season's snapshots, grouped by game.
 *
 * Chunked by game id rather than filtered on `season_id`, because
 * `line_snapshots` has no season column — it references the game and nothing
 * else. `SNAPSHOT_COLS` is deliberately not reused: that constant is shared by
 * the opener and the closing readers and carries only what they need, and
 * `total` is one of the things this wants.
 */
async function fetchSeasonSnapshots(
  db: SupabaseClient,
  games: GameRow[],
): Promise<Map<number, SnapshotLike[]>> {
  const out = new Map<number, SnapshotLike[]>();
  const ids = games.map((g) => g.id);
  const CHUNK = 200;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const rows = await pageAll<SnapshotLike & { game_id: number }>((from, to) =>
      db
        .from("line_snapshots")
        .select("game_id, provider, spread, spread_open, total, captured_at")
        .in("game_id", slice)
        .order("game_id")
        .range(from, to),
    );
    for (const r of rows) {
      const arr = out.get(r.game_id);
      if (arr) arr.push(r);
      else out.set(r.game_id, [r]);
    }
  }
  return out;
}

/**
 * The whole archive, best game first.
 *
 * `minSeason` exists so a caller can decline the deep past without the deck
 * query knowing why — Chains happily compares a 2015 game nobody watched,
 * because a comparison is not a recall test, while The Tape may not want to.
 */
export async function fetchSalienceDeck(
  db: SupabaseClient,
  opts: { minSeason?: number } = {},
): Promise<DeckGame[]> {
  const seasons = (await cfbSeasons(db)).filter(
    (s) => opts.minSeason === undefined || s >= opts.minSeason,
  );
  const rivalries = await fetchRivalries(db);

  const all: DeckGame[] = [];
  for (const seasonId of seasons) {
    all.push(...(await fetchSeasonDeck(db, seasonId, rivalries)));
  }
  return rankBySalience(all);
}

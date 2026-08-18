/**
 * Depth Chart's fact index — what the game believes about teams.
 *
 * Facts are MATERIALISED rather than evaluated as predicates. Two reasons, and
 * the second is the important one:
 *
 *   1. The validator asks "does tile t satisfy category c" tens of thousands of
 *      times per grid, and a set lookup is the only way that is free.
 *   2. A materialised fact is **auditable**. The owner can read `dc_facts` and
 *      see exactly what the game thinks is true; a predicate buried in a job is
 *      a claim nobody can check until it produces a wrong puzzle.
 *
 * Every kind here settles from rows already in the database — the same closure
 * discipline `six-pack.ts` applies to its questions. `conference_in`
 * specifically reads `games.home_conference` / `away_conference` (BF-2, the
 * alignment AT KICKOFF) and NOT `teams.conference`: "were in the Big 12 in
 * 2016" built from today's alignment would list Texas and Oklahoma as Big 12
 * members and omit Missouri and Nebraska, which is the single most obviously
 * wrong thing this game could say.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeckGame } from "../../src/lib/salience-data";
import type { DcCategory } from "../../src/lib/depth-chart";

/** A category needs at least this many members to be drawable. */
export const MIN_MEMBERS = 4;
/** Past this a fact is too broad to be a group — "all FBS teams" is not a clue. */
export const MAX_MEMBERS = 40;

export interface RawFact {
  kind: string;
  /** Unique within the kind, so a regenerated fact replaces its predecessor. */
  subject: string;
  label: string;
  members: Set<number>;
}

const add = (m: Map<string, RawFact>, kind: string, subject: string, label: string, team: number) => {
  const key = `${kind}:${subject}`;
  const hit = m.get(key);
  if (hit) hit.members.add(team);
  else m.set(key, { kind, subject, label, members: new Set([team]) });
};

/**
 * Build every fact the archive supports.
 *
 * `schools` is needed for the labels, and a fact whose subject team we cannot
 * name is dropped rather than labelled "team 4213" — an unreadable category is
 * an unsolvable one.
 */
export function buildFacts(
  deck: DeckGame[],
  schools: Map<number, string>,
  venues: Map<number, { state: string | null; dome: boolean }>,
  finalTop10: Array<{ season: number; teamId: number }>,
): RawFact[] {
  const facts = new Map<string, RawFact>();

  for (const g of deck) {
    const homeWon = g.homePoints > g.awayPoints;
    const winner = homeWon ? g.homeTeamId : g.awayTeamId;
    const loser = homeWon ? g.awayTeamId : g.homeTeamId;
    const winnerName = schools.get(winner);
    const loserName = schools.get(loser);

    /* "Lost to X in Y" and "Beat X in Y" — the bread and butter of a grouping
       game, and the kind a fan can verify instantly. */
    if (winnerName) {
      add(facts, "lost_to", `${winner}:${g.seasonId}`, `Lost to ${winnerName} in ${g.seasonId}`, loser);
    }
    if (loserName) {
      add(facts, "beat", `${loser}:${g.seasonId}`, `Beat ${loserName} in ${g.seasonId}`, winner);
    }

    /* Conference AT KICKOFF (BF-2), never `teams.conference`. */
    if (g.homeConference) {
      add(
        facts,
        "conference_in",
        `${g.homeConference}:${g.seasonId}`,
        `Were in the ${g.homeConference} in ${g.seasonId}`,
        g.homeTeamId,
      );
    }
    if (g.awayConference) {
      add(
        facts,
        "conference_in",
        `${g.awayConference}:${g.seasonId}`,
        `Were in the ${g.awayConference} in ${g.seasonId}`,
        g.awayTeamId,
      );
    }

    /* Where a team actually plays, from its own non-neutral home venues — the
       same derivation GTG-9 used for region, and for the same reason: a
       conference is not a place. */
    if (!g.neutralSite && g.venueId !== null) {
      const v = venues.get(g.venueId);
      if (v?.dome) add(facts, "dome", "dome", "Play their home games indoors", g.homeTeamId);
      if (v?.state) {
        add(facts, "state", v.state, `Play their home games in ${v.state}`, g.homeTeamId);
      }
    }
  }

  for (const t of finalTop10) {
    add(facts, "ap_top10", String(t.season), `Finished the ${t.season} AP top ten`, t.teamId);
  }

  return [...facts.values()].filter(
    (f) => f.members.size >= MIN_MEMBERS && f.members.size <= MAX_MEMBERS,
  );
}

/** A raw fact, as the validator wants it. */
export function toCategory(f: RawFact, id: string): DcCategory {
  return { id, label: f.label, members: f.members };
}

/** Venue state and dome, for the geography facts. */
export async function fetchVenues(
  db: SupabaseClient,
): Promise<Map<number, { state: string | null; dome: boolean }>> {
  const out = new Map<number, { state: string | null; dome: boolean }>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("venues")
      .select("id, state, dome")
      .order("id")
      .range(from, from + 999);
    const rows = (data ?? []) as Array<{ id: number; state: string | null; dome: boolean }>;
    for (const v of rows) out.set(v.id, { state: v.state, dome: v.dome });
    if (rows.length < 1000) return out;
  }
}

/**
 * Final-week AP top tens, per season.
 *
 * The FINAL poll specifically — "finished the 2019 AP top ten" is a fact about
 * how a season ended, and taking any other week would make it a fact about a
 * Tuesday.
 */
export async function fetchFinalTop10(
  db: SupabaseClient,
): Promise<Array<{ season: number; teamId: number }>> {
  const { data } = await db
    .from("poll_rankings")
    .select("season_id, week, poll, team_id, rank")
    .eq("poll", "AP Top 25")
    .lte("rank", 10);
  const rows = (data ?? []) as Array<{
    season_id: number;
    week: number;
    team_id: number;
    rank: number;
  }>;

  const lastWeek = new Map<number, number>();
  for (const r of rows) {
    lastWeek.set(r.season_id, Math.max(lastWeek.get(r.season_id) ?? 0, r.week));
  }
  return rows
    .filter((r) => r.week === lastWeek.get(r.season_id))
    .map((r) => ({ season: r.season_id, teamId: r.team_id }));
}

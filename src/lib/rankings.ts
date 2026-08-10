/**
 * Poll-ranking helpers — pure, shared by the sync job and the display layer.
 * Polls are context next to the model's own rank; never fed to the model.
 */

/** CFBD /rankings gives school NAMES; index school + alt_names → team id. */
export function buildTeamNameIndex(
  teams: Array<{ id: number; school: string; alt_names: string[] | null }>,
): Map<string, number> {
  const index = new Map<string, number>();
  for (const t of teams) {
    index.set(t.school.toLowerCase(), t.id);
    for (const alt of t.alt_names ?? []) index.set(alt.toLowerCase(), t.id);
  }
  return index;
}

export interface PollRankInput {
  week: number;
  poll: string;
  team_id: number;
  rank: number;
}

/** Priority once multiple polls exist for a week: committee > AP > coaches. */
const POLL_PRIORITY = ["Playoff Committee Rankings", "AP Top 25", "Coaches Poll"];

/**
 * Ranks to display: the latest week available, preferring the CFP committee
 * once it starts publishing, else AP, else Coaches.
 */
export function pickPollRanks(rows: PollRankInput[]): {
  poll: string | null;
  byTeam: Map<number, number>;
} {
  if (rows.length === 0) return { poll: null, byTeam: new Map() };
  const latestWeek = Math.max(...rows.map((r) => r.week));
  const atWeek = rows.filter((r) => r.week === latestWeek);
  const poll = POLL_PRIORITY.find((p) => atWeek.some((r) => r.poll === p)) ?? atWeek[0].poll;
  const byTeam = new Map<number, number>();
  for (const r of atWeek) if (r.poll === poll) byTeam.set(r.team_id, r.rank);
  return { poll, byTeam };
}

/** "AP" / "CFP" / "Coaches" for compact pips. */
export function pollShortName(poll: string | null): string | null {
  if (poll === null) return null;
  if (poll === "AP Top 25") return "AP";
  if (poll === "Playoff Committee Rankings") return "CFP";
  if (poll === "Coaches Poll") return "Coaches";
  return poll;
}

/**
 * What a fan calls it. CFBD's own strings are either too long to be a tab
 * ("Playoff Committee Rankings") or ambiguous once they sit next to two other
 * polls ("AP Top 25" is a poll, not a top-25 of something) — and a rankings
 * page that does not say which body ranked them is a page of numbers with no
 * author.
 */
export function pollDisplayName(poll: string): string {
  if (poll === "AP Top 25") return "AP Poll";
  if (poll === "Playoff Committee Rankings") return "CFP Rankings";
  return poll;
}

/* ---- where a team sits in the field ------------------------------------- */

export interface FieldPlacement {
  /** 1 = best. Ties share the better rank, as a leaderboard does. */
  rank: number;
  /** How many teams were ranked — "#14 of 136" needs both halves. */
  of: number;
  /** 0..1, where 1 is the top of the field. */
  percentile: number;
}

/**
 * Rank and percentile for one value within a field of them.
 *
 * This was computed ad hoc in five places — RatingsTable, /team/[id],
 * /rankings, /teams and the slate query — each with its own sort or
 * count-of-better, and no percentile anywhere despite spec §3 promising one.
 * A rank alone still doesn't say much: #14 is excellent in a field of 136 and
 * mid-table in a field of 20, which is exactly the context a bare number is
 * missing.
 *
 * `higherIsBetter: false` handles a scale where a low number wins.
 */
export function rankAndPercentile(
  values: number[],
  value: number,
  higherIsBetter = true,
): FieldPlacement | null {
  const of = values.length;
  if (of === 0) return null;
  const better = values.filter((v) => (higherIsBetter ? v > value : v < value)).length;
  const rank = better + 1;
  // With one team the percentile is undefined rather than 0 or 1; call it the
  // top, since a field of one has no spread to place anything within.
  const percentile = of === 1 ? 1 : (of - rank) / (of - 1);
  return { rank, of, percentile };
}

/** "top 10%" / "bottom 15%" / "middle of the field" — the percentile, said. */
export function describePlacement(p: FieldPlacement): string {
  const pct = Math.round(p.percentile * 100);
  if (pct >= 90) return `top ${Math.max(1, 100 - pct)}%`;
  if (pct >= 60) return `top ${100 - pct}%`;
  if (pct <= 10) return `bottom ${Math.max(1, pct)}%`;
  if (pct <= 40) return `bottom ${pct}%`;
  return "middle of the field";
}

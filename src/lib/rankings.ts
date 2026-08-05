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

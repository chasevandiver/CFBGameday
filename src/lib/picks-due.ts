/**
 * "How many picks does this person still owe?" — one definition, so the badge
 * on the Groups tab and the push that nags about the same thing can never
 * disagree about what "done" means.
 *
 * The rule, matching `notifyPicksDueJob` (scripts/lib/notify-jobs.ts): a game
 * counts as picked when the member has ANY pick on it. A pool board can carry
 * two markets for one game — the spread and the total — and requiring both
 * would badge someone who has done everything the board asked of them. Being
 * wrong in that direction is worse: a badge that will not clear is a badge
 * people learn to ignore, and then it is worth nothing on the Saturday it
 * matters.
 *
 * Kicked-off games are excluded because a pick you can no longer make is not
 * a pick you owe. `make_pick` refuses them at the database (`Kickoff — picks
 * are locked for this game`), so counting them would badge a debt the app
 * will not let anyone pay.
 */

export interface PicksDueInput {
  /** Every game on the viewer's group boards for the open week(s). */
  boardGameIds: number[];
  /** Games they already have at least one pick on. */
  pickedGameIds: Iterable<number>;
  /** Games whose kickoff has passed — locked, and no longer owed. */
  lockedGameIds: Iterable<number>;
}

export function openPickCount({
  boardGameIds,
  pickedGameIds,
  lockedGameIds,
}: PicksDueInput): number {
  const picked = new Set(pickedGameIds);
  const locked = new Set(lockedGameIds);
  return boardGameIds.filter((id) => !picked.has(id) && !locked.has(id)).length;
}

/**
 * What the badge shows. A number up to 9, then "9+" — past that the count has
 * stopped being information and started being a wall of digits in a 62px tab.
 */
export function badgeLabel(open: number): string | null {
  if (open <= 0) return null;
  return open > 9 ? "9+" : String(open);
}

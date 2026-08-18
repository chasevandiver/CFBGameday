/**
 * Depth Chart (DC-1) — sixteen teams, four hidden groups of four.
 *
 * ## Why this one is different from the other two
 *
 * The Tape and Chains both name what they are about, so neither can promise
 * secrecy: every fact in them is public, in this database and on the open
 * internet. Depth Chart is the one game in the set with a real hidden answer,
 * because the thing being hidden is not a FACT, it is a GROUPING — and no
 * amount of looking up tells you which four categories today's sixteen tiles
 * were drawn from.
 *
 * ## Fairness is the entire engineering problem
 *
 * A grid only works if exactly one assignment of tiles to categories is
 * possible. Generating categories from a fact index produces overlapping tiles
 * constantly — a team that plays in a dome AND lost to Georgia in 2022 can sit
 * in either group, and if two such swaps exist the puzzle has two solutions and
 * the player who finds the "wrong" one is right and marked wrong. That is not
 * hard, it is unfair, which is worse than the problem this game is here to fix.
 *
 * Two kinds of ambiguity, and only one of them is solvable:
 *
 *   - **Internal**: given these four categories and these sixteen tiles, is the
 *     assignment unique? Exactly solvable — `countPartitions` below.
 *   - **External**: could a player find a fifth coherent grouping the fact
 *     index has never heard of ("these four are all in Ohio")? Not solvable in
 *     general; NYT's Connections has the same hole. What IS promised is
 *     bounded and stated plainly: **no fact we store covers exactly four of the
 *     sixteen tiles** beyond the four intended. Anything outside the index is
 *     outside the promise.
 */

export interface DcCategory {
  /** Stable key, so a grid can name its categories without their wording. */
  id: string;
  /** What the group is called once solved: "Lost to Georgia in 2022". */
  label: string;
  /** Every CFB team the fact is true of — the whole membership, not the four drawn. */
  members: Set<number>;
  /**
   * Whether a player could plausibly SPOT this grouping by looking at sixteen
   * school names — geography, conference, a poll finish, a dome.
   *
   * Only spottable facts can act as red herrings, and that distinction is what
   * `validateGrid`'s Pass B turns on. See the note there: it is the difference
   * between a check that protects the player and one that rejects 85% of fair
   * grids over coincidences nobody could see.
   */
  spottable: boolean;
}

export interface DcGrid {
  /** Four categories, hardest last — the difficulty ramp Connections uses. */
  groups: Array<{ id: string; label: string; teamIds: number[] }>;
  /** The sixteen tiles in presentation order. */
  tiles: number[];
}

/** Why a candidate grid was thrown away. Named so the job can say which. */
export type DcReject = "ambiguous" | "rival_category" | "too_easy" | "short";

/**
 * How many ways the tiles can be partitioned into the groups, capped at
 * `limit`.
 *
 * `matrix[t][c]` is "tile t satisfies category c" — note that this is FACT
 * membership, not the intended assignment, so a tile that also happens to
 * satisfy another chosen category is visible to the search. That is the entire
 * point; a validator built on the intended assignment would prove only that the
 * generator agrees with itself.
 *
 * ## Why this is cheap despite being a hard problem in general
 *
 * Counting these is the permanent of a structured 0/1 matrix, which is #P-hard
 * at scale and completely trivial at this one: the state is (tile index,
 * remaining capacity per group), so there are 16 x 5^4 = 10,000 states, each
 * branching over at most four groups. Sub-millisecond, and it runs at
 * generation rather than per request.
 *
 * Tiles are visited most-constrained-first, which prunes hard: a tile that
 * satisfies exactly one category forces its group immediately.
 *
 * **Early exit interacts with memoisation correctly, and it is worth saying why
 * because it looks unsafe.** When the running total reaches `limit` the search
 * stops and caches the truncated value. A cached truncated value is always
 * >= limit, so any parent reusing it also reaches limit. The answer is
 * therefore exact whenever it is below `limit` and "at least `limit`"
 * otherwise — which is precisely the question being asked ("is it exactly
 * one?"). The returned number can overshoot `limit`, because one memoised
 * subtree returns more than one at a time; it is a verdict, not a count, and
 * the test asserts a range rather than an equality for exactly that reason.
 */
export function countPartitions(matrix: boolean[][], cap = 4, limit = 2): number {
  const n = matrix.length;
  if (n === 0) return 1;
  const k = matrix[0]!.length;

  const popcount = (row: boolean[]) => row.reduce((t, b) => t + (b ? 1 : 0), 0);
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => popcount(matrix[a]!) - popcount(matrix[b]!) || a - b,
  );

  const memo = new Map<string, number>();
  const caps = Array<number>(k).fill(cap);

  const dfs = (i: number): number => {
    if (i === n) return 1;
    const key = `${i}:${caps.join(",")}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    let total = 0;
    const row = matrix[order[i]!]!;
    for (let c = 0; c < k; c++) {
      if (!row[c] || caps[c] === 0) continue;
      caps[c] -= 1;
      total += dfs(i + 1);
      caps[c] += 1;
      if (total >= limit) break;
    }
    memo.set(key, total);
    return total;
  };

  return dfs(0);
}

/** `matrix[t][c]` for the given tiles against the given categories. */
export function membershipMatrix(tiles: number[], groups: DcCategory[]): boolean[][] {
  return tiles.map((t) => groups.map((g) => g.members.has(t)));
}

/**
 * How many tiles could plausibly sit in more than one group.
 *
 * A grid where every tile satisfies exactly one category is a word search, not
 * a puzzle — the traps are what make it feel designed rather than sampled. This
 * counts the surplus memberships, and the generator prefers grids with more of
 * them among those that are still unique.
 */
export function trapCount(matrix: boolean[][]): number {
  return matrix.reduce(
    (t, row) => t + Math.max(0, row.reduce((n, b) => n + (b ? 1 : 0), 0) - 1),
    0,
  );
}

export const MIN_TRAPS = 2;

/**
 * Is this grid fair, interesting, and solvable exactly one way?
 *
 * Returns the reason on failure rather than a bare false, so the generator's
 * `detail` can report WHICH check is starving it — "ambiguous" means the fact
 * index has too much overlap, "too_easy" means too little, and the fix for one
 * is the opposite of the fix for the other.
 */
export function validateGrid(
  grid: DcGrid,
  chosen: DcCategory[],
  allFacts: DcCategory[],
): { ok: true; traps: number } | { ok: false; reject: DcReject } {
  if (grid.tiles.length !== 16 || chosen.length !== 4) return { ok: false, reject: "short" };

  const matrix = membershipMatrix(grid.tiles, chosen);

  // Pass A — internal uniqueness. The intended assignment is always a
  // solution, so "exactly one" also proves the unique solution IS the intended
  // one; no separate check is needed and there is a test asserting that.
  if (countPartitions(matrix) !== 1) return { ok: false, reject: "ambiguous" };

  /* Pass B — no rival category the player could actually SEE.
   *
   * A stored fact covering exactly four of the sixteen tiles is a grouping the
   * player might submit and the game would mark wrong. Two carve-outs, and the
   * second was learned the hard way.
   *
   * **Not if those four ARE an intended group.** That is corroboration, not
   * ambiguity — a second true label over the same four teams ("Play in a dome"
   * and "Play their home games in Louisiana") leads to the same submission and
   * the same verdict. Rejecting on the count alone threw away three quarters of
   * otherwise-fair grids.
   *
   * **And only for SPOTTABLE facts**, which is the fix for the failure this
   * check caused in production. Checked against every stored fact, it rejected
   * **9,555 of ~11,200 attempts (85%)** on the real index and left the queue at
   * one day. With 2,306 head-to-head facts over 266 teams, some fact covers
   * some four tiles by pure coincidence on essentially every grid.
   *
   * The mistake was conceptual rather than a bad threshold. "These four all
   * lost to Vanderbilt in 2019" is not a red herring: nobody scanning sixteen
   * school names spots it, so it can never be submitted by mistake. A red
   * herring has to be VISIBLE — geography, conference, a poll finish, a dome —
   * and there are 118 such facts against 2,306 result facts. Checking the other
   * 2,306 protected the player from nothing and cost the game its queue.
   *
   * What this gives up, stated plainly: a player who goes and looks up results
   * could construct a grouping the game rejects. That is outside the promise in
   * 0070's header either way, which was only ever about STORED facts — this
   * narrows it to stored facts a player could see unaided.
   *
   * NOT rejected on five or more: a fact covering six tiles cannot be a clean
   * group of four, and rejecting on it would starve the generator, since every
   * grid has some "these are all SEC schools" fact over it.
   */
  const chosenIds = new Set(chosen.map((c) => c.id));
  const intended = grid.groups.map((g) => [...g.teamIds].sort((a, b) => a - b).join(","));
  const tileSet = new Set(grid.tiles);
  for (const fact of allFacts) {
    if (!fact.spottable) continue;
    if (chosenIds.has(fact.id)) continue;
    const hits: number[] = [];
    for (const t of tileSet) if (fact.members.has(t)) hits.push(t);
    if (hits.length !== 4) continue;
    const key = hits.sort((a, b) => a - b).join(",");
    if (!intended.includes(key)) return { ok: false, reject: "rival_category" };
  }

  // Pass C — a difficulty floor.
  const traps = trapCount(matrix);
  if (traps < MIN_TRAPS) return { ok: false, reject: "too_easy" };

  return { ok: true, traps };
}

/* ---- play --------------------------------------------------------------- */

export const DC_MISTAKES = 4;
export const DC_GROUPS = 4;

export type DcVerdict = "correct" | "one_away" | "wrong";

/**
 * How a submitted four lands.
 *
 * "One away" exists because it is the feedback that makes the game teach you
 * something: it says your read was right and one tile was the trap, which is a
 * different piece of information from "no".
 */
export function dcJudge(selection: number[], groups: DcGrid["groups"]): {
  verdict: DcVerdict;
  groupId: string | null;
} {
  if (selection.length !== 4) return { verdict: "wrong", groupId: null };
  const picked = new Set(selection);

  let bestOverlap = 0;
  let bestId: string | null = null;
  for (const g of groups) {
    const overlap = g.teamIds.filter((t) => picked.has(t)).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestId = g.id;
    }
  }

  if (bestOverlap === 4) return { verdict: "correct", groupId: bestId };
  if (bestOverlap === 3) return { verdict: "one_away", groupId: null };
  return { verdict: "wrong", groupId: null };
}

export interface DcEntryState {
  /** Group ids solved, in the order they fell. */
  solved: string[];
  mistakes: number;
  /** Every four submitted, for the share grid. */
  guesses: Array<{ teamIds: number[]; verdict: DcVerdict }>;
  completed_at: string | null;
}

export const EMPTY_DC: DcEntryState = {
  solved: [],
  mistakes: 0,
  guesses: [],
  completed_at: null,
};

export function dcOver(entry: DcEntryState): boolean {
  return entry.mistakes >= DC_MISTAKES || entry.solved.length >= DC_GROUPS;
}

/**
 * Everything the client may see.
 *
 * The tiles are public — they are sixteen school names, and knowing which
 * sixteen narrows nothing. **The grouping is the answer**, so a group's label
 * and membership appear only once that group has been solved, or once the game
 * is over. Both conditions sit in one expression, so a later edit cannot reveal
 * a label while withholding its members — `gtgPayload`'s rule about gating
 * `answer` and `answerTeams` together, applied to the thing that matters here.
 */
export function dcPayload(
  day: string,
  grid: DcGrid,
  entry: DcEntryState,
  stats: { streak: number; bestStreak: number; played: number; won: number },
) {
  const over = dcOver(entry);
  const solved = new Set(entry.solved);
  const revealed = grid.groups.filter((g) => over || solved.has(g.id));
  const revealedTiles = new Set(revealed.flatMap((g) => g.teamIds));

  return {
    day,
    /* Only the tiles still in play — a solved group moves out of the board and
       into the list above it, which is what makes the grid shrink as you go. */
    tiles: grid.tiles.filter((t) => !revealedTiles.has(t)),
    solved: revealed.map((g) => ({
      id: g.id,
      label: g.label,
      teamIds: [...g.teamIds],
      /* Whether the PLAYER got it, as opposed to it being shown at the end.
         Without this a losing board looks identical to a winning one. */
      byPlayer: solved.has(g.id),
    })),
    mistakes: entry.mistakes,
    maxMistakes: DC_MISTAKES,
    /* The player's OWN submissions, copied back. Not a leak — they made them,
       and the share grid needs the tiles to colour its squares. Copied field by
       field rather than passed through, the same discipline as everything else
       in this function. */
    guesses: entry.guesses.map((g) => ({ teamIds: [...g.teamIds], verdict: g.verdict })),
    done: over,
    won: entry.solved.length >= DC_GROUPS,
    stats,
  };
}

/**
 * The share grid: one row of four squares per attempt, coloured by the group
 * that attempt belonged to.
 *
 * Spoiler-free by construction — it carries no school names and no category
 * labels, so it says how you got there without saying what "there" was.
 */
const DC_CELL = ["🟨", "🟩", "🟦", "🟪"] as const;

export function dcShareBlock(
  day: string,
  grid: DcGrid,
  entry: DcEntryState,
  streak = 0,
): string {
  const colourOf = (teamId: number): string => {
    const i = grid.groups.findIndex((g) => g.teamIds.includes(teamId));
    return i >= 0 ? DC_CELL[i]! : "⬛";
  };
  const rows = entry.guesses.map((g) => g.teamIds.map(colourOf).join("")).join("\n");
  const score = entry.solved.length >= DC_GROUPS ? `${entry.mistakes} off` : "X";
  const footer = streak > 0 ? `\nStreak ${streak}` : "";
  return `Depth Chart · ${day} · ${score}\n${rows}${footer}`;
}

import { describe, expect, it } from "vitest";
import {
  DC_MISTAKES,
  EMPTY_DC,
  countPartitions,
  dcJudge,
  dcOver,
  dcPayload,
  dcShareBlock,
  membershipMatrix,
  trapCount,
  validateGrid,
  type DcCategory,
  type DcGrid,
} from "./depth-chart";

/**
 * The validator is the whole build, so it gets the most tests. A grid that is
 * merely hard is fine; a grid with two solutions marks a correct player wrong,
 * which is unfair — and unfair is worse than the problem this game exists to
 * fix.
 */

/** 16x4, each tile in exactly one category: the unambiguous base case. */
const clean = (): boolean[][] =>
  Array.from({ length: 16 }, (_, t) =>
    Array.from({ length: 4 }, (_, c) => Math.floor(t / 4) === c),
  );

describe("countPartitions", () => {
  it("finds exactly one way when every tile fits exactly one group", () => {
    expect(countPartitions(clean())).toBe(1);
  });

  /**
   * The interesting case, and the one a naive "any tile in two categories is
   * ambiguous" heuristic gets wrong: an overlap that the capacities resolve.
   * Tile 0 fits groups 0 and 1, but group 1 is already full from its own four,
   * so there is still only one partition. Rejecting this grid would throw away
   * exactly the puzzles that feel designed.
   */
  it("allows an overlap the capacities still resolve", () => {
    const m = clean();
    m[0]![1] = true;
    expect(countPartitions(m)).toBe(1);
  });

  /** A genuine two-solution swap: two tiles that can trade places. */
  it("detects a swap between two groups", () => {
    const m = clean();
    m[0]![1] = true; // tile 0 -> group 0 or 1
    m[4]![0] = true; // tile 4 -> group 1 or 0
    expect(countPartitions(m)).toBeGreaterThanOrEqual(2);
  });

  /**
   * Early exit caches a truncated count. That is safe because a truncated value
   * is always >= limit, so a parent reusing it also reaches limit — the answer
   * is exact below the limit and "at least the limit" above it, which is the
   * question actually being asked.
   */
  it("stops counting at the limit rather than enumerating everything", () => {
    // Every tile fits every group: the true count is 16!/(4!^4) = 63,063,000.
    // The returned number only has to answer "is it exactly one?", so what is
    // asserted is that it says no and that it did not enumerate to get there.
    // It can overshoot the limit — a single memoised subtree returns more than
    // one at a time — which is fine and is why this is a range, not an equality.
    const everything = Array.from({ length: 16 }, () => [true, true, true, true]);
    const n = countPartitions(everything);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThan(1000);
  });

  it("returns zero when a tile fits nothing", () => {
    const m = clean();
    m[0] = [false, false, false, false];
    expect(countPartitions(m)).toBe(0);
  });
});

/* ---- the validator over real-shaped categories -------------------------- */

/**
 * Spottable by default: that is the STRICT case for Pass B, so a test that
 * forgets to think about it gets the check switched on rather than off.
 */
const cat = (id: string, members: number[], spottable = true): DcCategory => ({
  id,
  label: id,
  members: new Set(members),
  spottable,
});

const gridOf = (groups: DcCategory[], picks: number[][]): DcGrid => ({
  groups: groups.map((g, i) => ({ id: g.id, label: g.label, teamIds: picks[i]! })),
  tiles: picks.flat(),
});

describe("validateGrid", () => {
  // Four categories with a couple of deliberate overlaps: enough traps to be
  // interesting, still exactly one solution.
  const chosen = [
    cat("a", [1, 2, 3, 4, 5]),
    cat("b", [5, 6, 7, 8]),
    cat("c", [9, 10, 11, 12, 1]),
    cat("d", [13, 14, 15, 16]),
  ];
  const picks = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
  ];

  it("accepts a grid with one solution and some traps", () => {
    const res = validateGrid(gridOf(chosen, picks), chosen, chosen);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.traps).toBeGreaterThanOrEqual(2);
  });

  it("rejects a grid with two solutions", () => {
    const swappy = [
      cat("a", [1, 2, 3, 4, 5]),
      cat("b", [5, 6, 7, 8, 1]),
      cat("c", [9, 10, 11, 12]),
      cat("d", [13, 14, 15, 16]),
    ];
    const res = validateGrid(gridOf(swappy, picks), swappy, swappy);
    expect(res).toEqual({ ok: false, reject: "ambiguous" });
  });

  /**
   * The external-ambiguity bound, and the only promise this game makes about
   * it: a stored fact covering exactly four of the sixteen tiles is a red
   * herring the game would mark wrong, so the grid goes back.
   */
  it("rejects a grid a rival stored fact also groups", () => {
    const rival = cat("rival", [1, 6, 11, 16]);
    const res = validateGrid(gridOf(chosen, picks), chosen, [...chosen, rival]);
    expect(res).toEqual({ ok: false, reject: "rival_category" });
  });

  /**
   * The refinement that made the generator usable at all. A rival fact whose
   * four tiles ARE one of the intended groups is corroboration, not ambiguity:
   * a second true label over the same four teams leads to the same submission
   * and the same verdict.
   *
   * The first version rejected on the count alone and threw away about three
   * quarters of otherwise-fair grids, because a dense index almost always has
   * some fact lying exactly over one of the chosen groups.
   */
  it("tolerates a rival fact that covers exactly one intended group", () => {
    const corroborating = cat("corroborating", [1, 2, 3, 4, 99]);
    expect(validateGrid(gridOf(chosen, picks), chosen, [...chosen, corroborating]).ok).toBe(true);
  });

  /**
   * The production fix. Checked against every stored fact, this rejected 85% of
   * grids on the real index and left the queue at one day — because with 2,306
   * head-to-head facts over 266 teams, some fact covers some four tiles by
   * coincidence on essentially every grid.
   *
   * "These four all lost to Vanderbilt in 2019" is not a red herring: nobody
   * scanning sixteen school names spots it, so it cannot be submitted by
   * mistake. Only a visible grouping can.
   */
  it("ignores a rival nobody could spot", () => {
    const unspottable = cat("result", [1, 6, 11, 16], false);
    expect(validateGrid(gridOf(chosen, picks), chosen, [...chosen, unspottable]).ok).toBe(true);
  });

  it("still rejects the same rival when it IS spottable", () => {
    const spottable = cat("state", [1, 6, 11, 16], true);
    expect(validateGrid(gridOf(chosen, picks), chosen, [...chosen, spottable])).toEqual({
      ok: false,
      reject: "rival_category",
    });
  });

  /**
   * NOT rejected on five or more. A fact covering six tiles cannot be a clean
   * group of four, and rejecting on it would starve the generator — every grid
   * has some "these are all SEC schools" fact lying over it.
   */
  it("tolerates a stored fact that covers five or more", () => {
    const broad = cat("broad", [1, 2, 3, 4, 5, 6]);
    expect(validateGrid(gridOf(chosen, picks), chosen, [...chosen, broad]).ok).toBe(true);
  });

  /** A grid with no overlaps at all is a word search, not a puzzle. */
  it("rejects a grid with no traps", () => {
    const flat = [
      cat("a", [1, 2, 3, 4]),
      cat("b", [5, 6, 7, 8]),
      cat("c", [9, 10, 11, 12]),
      cat("d", [13, 14, 15, 16]),
    ];
    expect(validateGrid(gridOf(flat, picks), flat, flat)).toEqual({
      ok: false,
      reject: "too_easy",
    });
  });

  it("refuses a malformed grid outright", () => {
    const short = { groups: [], tiles: [1, 2] } as unknown as DcGrid;
    expect(validateGrid(short, chosen, chosen)).toEqual({ ok: false, reject: "short" });
  });

  /**
   * Uniqueness also proves the unique solution is the INTENDED one — the
   * intended assignment is always a solution, so if there is exactly one, it is
   * that one. Asserted rather than left as a comment.
   */
  it("means the one solution is the intended assignment", () => {
    const matrix = membershipMatrix(gridOf(chosen, picks).tiles, chosen);
    expect(countPartitions(matrix)).toBe(1);
    // the intended assignment satisfies the matrix
    gridOf(chosen, picks).groups.forEach((g, c) => {
      for (const t of g.teamIds) {
        expect(chosen[c]!.members.has(t)).toBe(true);
      }
    });
  });
});

describe("trapCount", () => {
  it("counts surplus memberships, not tiles", () => {
    const m = clean();
    m[0]![1] = true;
    m[0]![2] = true;
    expect(trapCount(m)).toBe(2);
  });
});

/* ---- play --------------------------------------------------------------- */

const groups: DcGrid["groups"] = [
  { id: "a", label: "Lost to Georgia in 2022", teamIds: [1, 2, 3, 4] },
  { id: "b", label: "Play in a dome", teamIds: [5, 6, 7, 8] },
  { id: "c", label: "Trophy game with Iowa", teamIds: [9, 10, 11, 12] },
  { id: "d", label: "Finished the 2019 AP top ten", teamIds: [13, 14, 15, 16] },
];
const grid: DcGrid = { groups, tiles: groups.flatMap((g) => g.teamIds) };

describe("dcJudge", () => {
  it("takes the four", () => {
    expect(dcJudge([1, 2, 3, 4], groups)).toEqual({ verdict: "correct", groupId: "a" });
  });

  /**
   * "One away" is the feedback that makes the game teach you something: your
   * read was right and one tile was the trap, which is different information
   * from "no".
   */
  it("says one away on three of a group", () => {
    expect(dcJudge([1, 2, 3, 9], groups).verdict).toBe("one_away");
  });

  it("says wrong on a two-and-two", () => {
    expect(dcJudge([1, 2, 9, 10], groups).verdict).toBe("wrong");
  });

  it("refuses anything that is not four tiles", () => {
    expect(dcJudge([1, 2, 3], groups).verdict).toBe("wrong");
  });
});

describe("dcPayload", () => {
  const stats = { streak: 0, bestStreak: 0, played: 0, won: 0 };

  /**
   * The tiles are public — sixteen school names narrow nothing. THE GROUPING is
   * the answer, so no label and no membership may appear before its group falls.
   */
  it("never names an unsolved group", () => {
    const json = JSON.stringify(dcPayload("2026-08-18", grid, EMPTY_DC, stats));
    for (const g of groups) expect(json).not.toContain(g.label);
  });

  it("shows the tiles, because sixteen names give nothing away", () => {
    const p = dcPayload("2026-08-18", grid, EMPTY_DC, stats);
    expect(p.tiles).toHaveLength(16);
  });

  it("reveals a group once it is solved, and moves its tiles off the board", () => {
    const p = dcPayload("2026-08-18", grid, { ...EMPTY_DC, solved: ["a"] }, stats);
    expect(p.solved[0]!.label).toBe("Lost to Georgia in 2022");
    expect(p.solved[0]!.byPlayer).toBe(true);
    expect(p.tiles).toHaveLength(12);
  });

  it("reveals everything once the mistakes run out", () => {
    const p = dcPayload("2026-08-18", grid, { ...EMPTY_DC, mistakes: DC_MISTAKES }, stats);
    expect(p.done).toBe(true);
    expect(p.won).toBe(false);
    expect(p.solved).toHaveLength(4);
  });

  /** Without this a losing board looks exactly like a winning one. */
  it("distinguishes a group you solved from one you were shown", () => {
    const p = dcPayload(
      "2026-08-18",
      grid,
      { ...EMPTY_DC, solved: ["a"], mistakes: DC_MISTAKES },
      stats,
    );
    expect(p.solved.find((g) => g.id === "a")!.byPlayer).toBe(true);
    expect(p.solved.find((g) => g.id === "b")!.byPlayer).toBe(false);
  });

  it("is won only when all four fall", () => {
    const p = dcPayload("2026-08-18", grid, { ...EMPTY_DC, solved: ["a", "b", "c", "d"] }, stats);
    expect(p.done).toBe(true);
    expect(p.won).toBe(true);
  });
});

describe("dcOver", () => {
  it("ends on the fourth mistake", () => {
    expect(dcOver({ ...EMPTY_DC, mistakes: DC_MISTAKES - 1 })).toBe(false);
    expect(dcOver({ ...EMPTY_DC, mistakes: DC_MISTAKES })).toBe(true);
  });
});

describe("dcShareBlock", () => {
  it("says how you got there without saying what it was", () => {
    const block = dcShareBlock(
      "2026-08-18",
      grid,
      {
        ...EMPTY_DC,
        solved: ["a", "b", "c", "d"],
        mistakes: 1,
        guesses: [
          { teamIds: [1, 2, 3, 9], verdict: "one_away" },
          { teamIds: [1, 2, 3, 4], verdict: "correct" },
        ],
      },
      3,
    );
    expect(block).toContain("🟨🟨🟨🟦");
    expect(block).toContain("Streak 3");
    for (const g of groups) expect(block).not.toContain(g.label);
  });

  it("marks a board that was never finished", () => {
    const block = dcShareBlock("2026-08-18", grid, { ...EMPTY_DC, mistakes: DC_MISTAKES });
    expect(block).toContain("· X");
  });
});

describe("dcPayload — the player's own guesses", () => {
  const stats = { streak: 0, bestStreak: 0, played: 0, won: 0 };

  /**
   * A player's own submissions are not a leak — they made them — and the share
   * grid cannot colour its squares without the tiles.
   */
  it("copies back what you submitted", () => {
    const p = dcPayload(
      "2026-08-18",
      grid,
      { ...EMPTY_DC, guesses: [{ teamIds: [1, 2, 3, 9], verdict: "one_away" }] },
      stats,
    );
    expect(p.guesses[0]!.teamIds).toEqual([1, 2, 3, 9]);
    expect(p.guesses[0]!.verdict).toBe("one_away");
  });

  it("still names no unsolved group while doing it", () => {
    const json = JSON.stringify(
      dcPayload(
        "2026-08-18",
        grid,
        { ...EMPTY_DC, guesses: [{ teamIds: [1, 2, 3, 9], verdict: "one_away" }] },
        stats,
      ),
    );
    for (const g of groups) expect(json).not.toContain(g.label);
  });
});

import { describe, expect, it } from "vitest";
import { FakeSupabase, type FakeRow } from "../../scripts/lib/fake-supabase";
import { fetchArcade, weekKey } from "./arcade-data";
import type { ScopeRoster } from "./games-scope";

/**
 * The joining half. `arcade.ts` and `trophies.ts` are already pinned as pure
 * functions; what is untested without this file is the part that turns four
 * differently-shaped tables into their inputs — the grouping, the scope
 * filter, and the two decisions the header argues for (a viewer-only shelf,
 * and the Guess-the-Game floor under `weeksPlayed`).
 */

const ANN = "aaaaaaaa-0000-0000-0000-000000000001";
const BOB = "bbbbbbbb-0000-0000-0000-000000000002";
const OUTSIDER = "cccccccc-0000-0000-0000-000000000003";

const roster = (...ids: string[]): ScopeRoster => ({
  userIds: ids,
  nameById: new Map(ids.map((id, i) => [id, ["Ann", "Bob", "Cal"][i] ?? id])),
});

const client = (seed: Record<string, FakeRow[]>, gtg: FakeRow[] = []) => {
  const db = new FakeSupabase({
    streak_picks: [],
    line_guesses: [],
    six_pack_entries: [],
    gtg_guesses: [],
    ...seed,
  });
  return {
    from: (t: string) => db.from(t),
    rpc: async () => ({ data: gtg, error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
};

const row = (uid: string, day: string, result: "win" | "loss" | "void" | null) => ({
  user_id: uid,
  day,
  result,
});

describe("weekKey", () => {
  it("anchors on Monday", () => {
    // 2026-09-09 is a Wednesday.
    expect(weekKey("2026-09-09")).toBe("2026-09-07");
    expect(weekKey("2026-09-07")).toBe("2026-09-07");
  });

  it("puts Sunday at the END of its week, not the start of the next", () => {
    // A football week runs Tuesday's slate through Monday night; a Sunday that
    // opened a new week would split one weekend across two denominators.
    expect(weekKey("2026-09-13")).toBe("2026-09-07");
    expect(weekKey("2026-09-14")).toBe("2026-09-14");
  });

  it("crosses a month without inventing a week", () => {
    expect(weekKey("2026-10-01")).toBe("2026-09-28");
  });
});

describe("fetchArcade — the standings", () => {
  it("returns every member of the roster, including the ones at zero", () => {
    return fetchArcade(
      client({ streak_picks: [row(ANN, "2026-09-01", "win")] }),
      roster(ANN, BOB),
      ANN,
    ).then(({ standings }) => {
      expect(standings.map((r) => r.name).sort()).toEqual(["Ann", "Bob"]);
      expect(standings.find((r) => r.userId === BOB)!.total).toBe(0);
    });
  });

  it("keeps a non-member's rows out of the pool", async () => {
    const { standings } = await fetchArcade(
      client({
        streak_picks: [row(ANN, "2026-09-01", "win"), row(OUTSIDER, "2026-09-01", "win")],
      }),
      roster(ANN, BOB),
      ANN,
    );
    expect(standings).toHaveLength(2);
    expect(standings.some((r) => r.userId === OUTSIDER)).toBe(false);
  });

  it("folds six-pack entries into weeks, voids and all", async () => {
    const entries = (slate: number, results: Array<"correct" | "wrong" | "void">) =>
      results.map((result, i) => ({
        user_id: ANN,
        slate_id: slate,
        idx: i + 1,
        result,
        created_at: "2026-09-08T15:00:00Z",
      }));
    const { standings } = await fetchArcade(
      client({
        six_pack_entries: [
          // Five right and a postponement: a perfect week, because a void
          // leaves both the numerator and the bar alone.
          ...entries(1, ["correct", "correct", "correct", "correct", "correct", "void"]),
          ...entries(2, ["correct", "wrong", "wrong", "wrong", "wrong", "wrong"]),
        ],
      }),
      roster(ANN),
      ANN,
    );
    // 5 correct + the clean-sheet bonus, then 1 correct with no bonus.
    expect(standings[0]!.parts.sixPack).toBe(5 * 8 + 12 + 1 * 8);
  });

  it("takes Guess the Game's points from the RPC, untouched", async () => {
    const { standings } = await fetchArcade(
      client({}, [{ user_id: ANN, solved: 3, points: 15, played: 4 }]),
      roster(ANN),
      ANN,
    );
    expect(standings[0]!.parts.gtg).toBeCloseTo(15 * 1.67, 1);
  });

  it("floors weeksPlayed with the puzzle's own day count", async () => {
    // Ann has no dated row anywhere — her only game is the daily puzzle, whose
    // per-day rows are unreadable for anyone but herself. Fourteen days cannot
    // fit in one week, so the denominator must be at least two.
    const { standings } = await fetchArcade(
      client({}, [{ user_id: ANN, solved: 14, points: 42, played: 14 }]),
      roster(ANN),
      ANN,
    );
    const ann = standings[0]!;
    // Half the total, to the rounding the row reports — not the whole of it,
    // which is what a one-week denominator would have said.
    expect(ann.perWeek).toBeCloseTo(ann.total / 2, 0);
  });

  it("counts a week once however many games were played in it", async () => {
    const { standings } = await fetchArcade(
      client({
        streak_picks: [
          row(ANN, "2026-09-08", "win"),
          row(ANN, "2026-09-09", "win"),
          row(ANN, "2026-09-10", "win"),
        ],
      }),
      roster(ANN),
      ANN,
    );
    // Three wins, one calendar week: 30 points at 30 a week.
    expect(standings[0]!.total).toBe(30);
    expect(standings[0]!.perWeek).toBe(30);
  });
});

describe("fetchArcade — the shelf", () => {
  const tenInARow = Array.from({ length: 10 }, (_, i) =>
    row(BOB, `2026-09-${String(i + 1).padStart(2, "0")}`, "win"),
  );

  it("is the viewer's own — another member's run is not your trophy", async () => {
    const { trophies } = await fetchArcade(client({ streak_picks: tenInARow }), roster(ANN, BOB), ANN);
    expect(trophies).toEqual([]);
  });

  it("earns from the viewer's own rows", async () => {
    const { trophies } = await fetchArcade(
      client({ streak_picks: tenInARow.map((r) => ({ ...r, user_id: ANN })) }),
      roster(ANN, BOB),
      ANN,
    );
    expect(trophies.map((t) => t.id)).toContain("iron-man");
  });

  it("reads Ice Cold out of the viewer's own puzzle rows", async () => {
    const { trophies } = await fetchArcade(
      client({
        gtg_guesses: [
          { user_id: ANN, day: "2026-09-01", attempts: 1, solved_at: "2026-09-01T14:00:00Z" },
        ],
      }),
      roster(ANN),
      ANN,
    );
    expect(trophies.map((t) => t.id)).toContain("ice-cold");
  });

  it("is empty for a signed-out reader, who still gets the standings", async () => {
    const { standings, trophies } = await fetchArcade(
      client({ streak_picks: tenInARow }),
      roster(ANN, BOB),
      null,
    );
    expect(trophies).toEqual([]);
    expect(standings.find((r) => r.userId === BOB)!.total).toBe(100);
  });
});

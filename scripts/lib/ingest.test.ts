import { describe, expect, it } from "vitest";
import { dropUnknownGames } from "./ingest";

/**
 * The launch-morning failure this guards: CFBD's /lines grew a game id our
 * games table does not carry, the FK on line_snapshots.game_id failed the
 * whole append batch, and a day of snapshots (plus every chained
 * freeze-groups run) was lost over one foreign row. The filter keeps our
 * rows and names theirs.
 */
describe("dropUnknownGames", () => {
  const row = (game_id: number, provider = "p") => ({ game_id, provider });

  it("keeps known rows and drops unknown ones, naming each id once", () => {
    const rows = [row(1), row(2), row(2, "q"), row(3)];
    const { kept, dropped } = dropUnknownGames(rows, new Set([1, 3]));
    // Checked failing against the pre-fix behaviour (no filter): kept would
    // be all four rows and the insert would FK-fail on 2.
    expect(kept.map((r) => r.game_id)).toEqual([1, 3]);
    // 2 appears twice in rows (two providers) and once here — the report is
    // about the game, not the row count.
    expect(dropped).toEqual([2]);
  });

  it("passes everything through when every id is known", () => {
    const rows = [row(7), row(8)];
    const { kept, dropped } = dropUnknownGames(rows, new Set([7, 8, 9]));
    expect(kept).toHaveLength(2);
    expect(dropped).toEqual([]);
  });

  it("drops everything when nothing is known, rather than inserting any of it", () => {
    const { kept, dropped } = dropUnknownGames([row(4), row(5)], new Set());
    expect(kept).toEqual([]);
    expect(dropped).toEqual([4, 5]);
  });

  it("preserves row order and identity of kept rows", () => {
    const a = row(1, "a");
    const b = row(1, "b");
    const { kept } = dropUnknownGames([a, b], new Set([1]));
    // Same objects, same order — the filter must not rebuild or reorder what
    // it keeps, because captured_at pairing and provider grouping depend on it.
    expect(kept[0]).toBe(a);
    expect(kept[1]).toBe(b);
  });

  it("reports dropped ids sorted, so two runs with the same hole read identically", () => {
    const { dropped } = dropUnknownGames([row(9), row(3), row(9)], new Set());
    expect(dropped).toEqual([3, 9]);
  });
});

import { describe, expect, it } from "vitest";
import { PAGE, pageAll } from "./page-all";

/** A fake table of `n` rows, served the way PostgREST serves a `.range()`. */
function table(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const query = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { rows, calls, query };
}

describe("pageAll", () => {
  it("returns every row past the 1,000-row ceiling, in order", async () => {
    const t = table(PAGE * 4 + 423); // the Week 1 freeze: 4,423 snapshots
    const out = await pageAll<{ id: number }>(t.query);
    expect(out).toHaveLength(4423);
    expect(out[0].id).toBe(0);
    expect(out[4422].id).toBe(4422);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
      [4000, 4999],
    ]);
  });

  it("stops on a short page without an extra request", async () => {
    const t = table(560); // Week 0
    expect(await pageAll(t.query)).toHaveLength(560);
    expect(t.calls).toEqual([[0, 999]]);
  });

  it("asks once more when a page is exactly full", async () => {
    const t = table(PAGE);
    expect(await pageAll(t.query)).toHaveLength(PAGE);
    expect(t.calls).toHaveLength(2);
  });

  it("returns an empty list for an empty table and throws on an error", async () => {
    expect(await pageAll(table(0).query)).toEqual([]);
    await expect(
      pageAll(async () => ({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });
});

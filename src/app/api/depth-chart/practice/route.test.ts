/**
 * Depth Chart practice.
 *
 * The property this file exists for: **`solved` is a conclusion, never an
 * input.** The client sends the fours it submitted and the server replays them
 * through `dcJudge`; a client naming a group id it did not earn must reveal
 * nothing, because `dcPayload` reveals whatever `solved` contains.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DcGrid } from "../../../../lib/depth-chart";

const getUser = vi.fn();
vi.mock("../../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("../../../../lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

const grid: DcGrid = {
  groups: [
    { id: "a", label: "Lost to Georgia in 2022", teamIds: [1, 2, 3, 4] },
    { id: "b", label: "Play their home games indoors", teamIds: [5, 6, 7, 8] },
    { id: "c", label: "Were in the Big 12 in 2016", teamIds: [9, 10, 11, 12] },
    { id: "d", label: "Finished the 2019 AP top ten", teamIds: [13, 14, 15, 16] },
  ],
  tiles: [1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16],
};
const state = { round: { id: 3, grid, crests: {} } as unknown };

vi.mock("../../../../lib/practice-data", () => ({
  fetchDcPractice: async () => state.round,
}));

const get = async (qs = "") => {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/depth-chart/practice${qs}`) as never);
};
const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/depth-chart/practice", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
  );
};

beforeEach(() => {
  vi.resetModules();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  state.round = { id: 3, grid, crests: {} };
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/depth-chart/practice", () => {
  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await get()).status).toBe(401);
  });

  it("says so when the pool is empty", async () => {
    state.round = null;
    expect((await get()).status).toBe(404);
  });

  it("serves sixteen tiles and names no group", async () => {
    const res = await get();
    const raw = await res.clone().text();
    const body = await res.json();
    expect(body.tiles).toHaveLength(16);
    for (const g of grid.groups) expect(raw).not.toContain(g.label);
  });

  /**
   * The GET takes no progress at all, which closes the hole its first draft had:
   * a `solved=` query parameter would have let anyone reveal every label by
   * naming the four group ids.
   */
  it("ignores any attempt to declare progress on the URL", async () => {
    const raw = await (await get("?solved=a,b,c,d&mistakes=0")).text();
    for (const g of grid.groups) expect(raw).not.toContain(g.label);
  });
});

describe("POST /api/depth-chart/practice", () => {
  it("reveals a group that was actually earned", async () => {
    const body = await (await post({ id: 3, guesses: [[1, 2, 3, 4]] })).json();
    expect(body.lastVerdict).toBe("correct");
    expect(body.solved).toHaveLength(1);
    expect(body.solved[0].label).toBe("Lost to Georgia in 2022");
    expect(body.tiles).toHaveLength(12);
  });

  it("charges a mistake for one away", async () => {
    const body = await (await post({ id: 3, guesses: [[1, 2, 3, 9]] })).json();
    expect(body.lastVerdict).toBe("one_away");
    expect(body.mistakes).toBe(1);
  });

  it("replays the whole list, so the board state is the server's", async () => {
    const body = await (
      await post({ id: 3, guesses: [[1, 2, 3, 4], [5, 6, 7, 9], [5, 6, 7, 8]] })
    ).json();
    expect(body.solved.map((g: { id: string }) => g.id).sort()).toEqual(["a", "b"]);
    expect(body.mistakes).toBe(1);
  });

  it("stops replaying once the mistakes run out", async () => {
    const wrong = [[1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15], [4, 8, 12, 16]];
    const body = await (
      await post({ id: 3, guesses: [...wrong, [1, 2, 3, 4]] })
    ).json();
    expect(body.mistakes).toBe(4);
    expect(body.done).toBe(true);
    // The fifth submission is past the end of the board and must not count.
    expect(body.solved.filter((g: { byPlayer: boolean }) => g.byPlayer)).toHaveLength(0);
  });

  it("refuses tiles that are not on this board", async () => {
    expect((await post({ id: 3, guesses: [[1, 2, 3, 999]] })).status).toBe(422);
  });

  it("refuses anything that is not four distinct tiles", async () => {
    expect((await post({ id: 3, guesses: [[1, 2, 3]] })).status).toBe(422);
    expect((await post({ id: 3, guesses: [[1, 1, 2, 3]] })).status).toBe(422);
  });

  it("rejects a nonsense body", async () => {
    expect((await post({ id: "x", guesses: [[1, 2, 3, 4]] })).status).toBe(400);
    expect((await post({ id: 3, guesses: [] })).status).toBe(400);
  });
});

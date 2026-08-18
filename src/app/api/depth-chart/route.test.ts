/**
 * Depth Chart's route test.
 *
 * This is the one game of the three with a real hidden answer — the grouping is
 * not derivable from public data — so the leak assertions here are load-bearing
 * rather than best-effort, and the pure test cannot prove the route ships what
 * the payload builder produced.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DC_MISTAKES, EMPTY_DC, type DcEntryState, type DcGrid } from "../../../lib/depth-chart";

const getUser = vi.fn();
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const upsert = vi.fn();
vi.mock("../../../lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => ({ upsert }) }),
}));

const grid: DcGrid = {
  groups: [
    { id: "a", label: "Lost to Georgia in 2022", teamIds: [1, 2, 3, 4] },
    { id: "b", label: "Play their home games indoors", teamIds: [5, 6, 7, 8] },
    { id: "c", label: "Were in the Big 12 in 2016", teamIds: [9, 10, 11, 12] },
    { id: "d", label: "Finished the 2019 AP top ten", teamIds: [13, 14, 15, 16] },
  ],
  tiles: [1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16],
};

const state = { entry: { ...EMPTY_DC } as DcEntryState, hasDay: true };

vi.mock("../../../lib/depth-chart-data", () => ({
  fetchDcDay: async () => (state.hasDay ? { grid, crests: {} } : null),
  fetchDcEntry: async () => state.entry,
  fetchDcStanding: async () => ({
    lastDay: null,
    streak: 0,
    bestStreak: 0,
    best: null,
    dist: [],
    played: 0,
    won: 0,
  }),
}));

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/depth-chart", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
  );
};

const get = async () => {
  const { GET } = await import("./route");
  return GET();
};

beforeEach(() => {
  vi.resetModules();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  upsert.mockResolvedValue({ error: null });
  state.entry = { ...EMPTY_DC, solved: [], guesses: [] };
  state.hasDay = true;
});

afterEach(() => vi.clearAllMocks());

describe("GET /api/depth-chart", () => {
  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await get()).status).toBe(401);
  });

  it("says so honestly when there is no board", async () => {
    state.hasDay = false;
    expect((await get()).status).toBe(404);
  });

  /** The grouping is the answer, and this is the game where that is real. */
  it("puts no group label on the wire before it is solved", async () => {
    const body = await (await get()).text();
    for (const g of grid.groups) expect(body).not.toContain(g.label);
  });

  it("ships the sixteen tiles, because names give nothing away", async () => {
    const body = await (await get()).json();
    expect(body.tiles).toHaveLength(16);
  });
});

describe("POST /api/depth-chart", () => {
  it("takes a correct four and reveals only that group", async () => {
    const res = await post({ teamIds: [1, 2, 3, 4] });
    const body = await res.json();
    expect(body.lastVerdict).toBe("correct");
    expect(body.solved).toHaveLength(1);
    expect(body.tiles).toHaveLength(12);
    for (const g of grid.groups.slice(1)) expect(JSON.stringify(body)).not.toContain(g.label);
  });

  /** A kinder message, not a free guess — a near miss you can spend forever on
   *  is not a puzzle. */
  it("charges a mistake for one away, same as a miss", async () => {
    const body = await (await post({ teamIds: [1, 2, 3, 9] })).json();
    expect(body.lastVerdict).toBe("one_away");
    expect(body.mistakes).toBe(1);
  });

  it("ends and reveals everything on the last mistake", async () => {
    state.entry = { ...EMPTY_DC, mistakes: DC_MISTAKES - 1 };
    const body = await (await post({ teamIds: [1, 2, 9, 10] })).json();
    expect(body.done).toBe(true);
    expect(body.won).toBe(false);
    expect(body.solved).toHaveLength(4);
    // and only now do the labels appear
    expect(JSON.stringify(body)).toContain(grid.groups[3]!.label);
  });

  /** Without this a client could resubmit a solved group and farm the board. */
  it("refuses tiles that are no longer in play", async () => {
    state.entry = { ...EMPTY_DC, solved: ["a"] };
    expect((await post({ teamIds: [1, 2, 3, 4] })).status).toBe(422);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses anything that is not four distinct tiles", async () => {
    expect((await post({ teamIds: [1, 2, 3] })).status).toBe(400);
    expect((await post({ teamIds: [1, 1, 2, 3] })).status).toBe(400);
    expect((await post({ teamIds: [1, 2, 3, 999] })).status).toBe(422);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a finished board", async () => {
    state.entry = { ...EMPTY_DC, mistakes: DC_MISTAKES, completed_at: "2026-08-18T00:00:00Z" };
    expect((await post({ teamIds: [1, 2, 3, 4] })).status).toBe(409);
  });

  it("marks the board won once the fourth group falls", async () => {
    state.entry = { ...EMPTY_DC, solved: ["a", "b", "c"] };
    const body = await (await post({ teamIds: [13, 14, 15, 16] })).json();
    expect(body.won).toBe(true);
    expect(body.done).toBe(true);
  });
});

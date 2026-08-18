/**
 * The Tape's route test.
 *
 * Routes are the coverage gap this repo already paid for twice: GTG-1 and
 * GTG-3 both lived inside a route, neither was reachable from a unit test, and
 * the puzzle said "no puzzle today" for weeks with everything green
 * (`docs/STATUS.md` §23 #42). Three new routes should not repeat it.
 *
 * `tape.test.ts` can prove `tapePayload` is clean. It cannot prove the route
 * returns what `tapePayload` produced, or that the two 409s fire — and the
 * "no going back" rule is the only thing making the round's question order
 * mean anything, so it is worth a test at the layer that enforces it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTape, type TapeCtx } from "../../../lib/tape";

const getUser = vi.fn();
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const upsert = vi.fn();
const day = { fixture: null as unknown, questions: [] as unknown[] };
const entry = { answers: [] as unknown[], completed_at: null as string | null };

vi.mock("../../../lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => ({ upsert }) }),
}));

vi.mock("../../../lib/tape-data", () => ({
  fetchTapeDay: async () => day.fixture === null ? null : day,
  fetchTapeEntry: async () => entry,
  fetchTapeStanding: async () => ({
    lastDay: null,
    streak: 0,
    bestStreak: 0,
    best: null,
    dist: [],
    played: 0,
    won: 0,
  }),
}));

const ctx: TapeCtx = {
  homeSchool: "Auburn",
  awaySchool: "Alabama",
  homePoints: 41,
  awayPoints: 38,
  season: 2013,
  week: 14,
  seasonType: "regular",
  neutralSite: false,
  conferenceGame: true,
  spread: 10.5,
  total: 55.5,
  pollPublished: true,
  homeRank: 4,
};

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/tape", {
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
  day.questions = buildTape(ctx);
  day.fixture = {
    season: 2013,
    week: 14,
    seasonType: "regular",
    neutralSite: false,
    homeSchool: "Auburn",
    awaySchool: "Alabama",
    homeTeamId: 2,
    awayTeamId: 333,
    homePoints: 41,
    awayPoints: 38,
  };
  entry.answers = [];
  entry.completed_at = null;
});

afterEach(() => vi.clearAllMocks());

describe("GET /api/tape", () => {
  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await get()).status).toBe(401);
  });

  it("says so honestly when there is no round", async () => {
    day.fixture = null;
    expect((await get()).status).toBe(404);
  });

  /**
   * The unit test proves the payload builder withholds the score. This proves
   * the route ships what the builder produced — the step between them is where
   * a leak would actually live.
   */
  it("does not put the final score on the wire before the round is over", async () => {
    const body = await (await get()).text();
    expect(body).not.toContain("41");
    expect(body).not.toContain("38");
  });

  it("names the fixture, which is the hook", async () => {
    const body = await (await get()).json();
    expect(body.fixture.homeSchool).toBe("Auburn");
    expect(body.current.idx).toBe(0);
  });
});

describe("POST /api/tape", () => {
  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await post({ idx: 0, choice: "Auburn" })).status).toBe(401);
  });

  it("grades the answer server-side and records it", async () => {
    const res = await post({ idx: 0, choice: "Auburn" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history[0].correct).toBe(true);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("marks a wrong answer wrong", async () => {
    const body = await (await post({ idx: 0, choice: "Alabama" })).json();
    expect(body.history[0].correct).toBe(false);
  });

  /**
   * "No going back", enforced rather than requested. A replayed request, or two
   * sent out of order, lands here — and without this the round's question order
   * means nothing, because later questions become answerable once earlier ones
   * settle.
   */
  it("refuses a question that is not the one in play", async () => {
    entry.answers = [{ idx: 0, choice: "Auburn", correct: true }];
    expect((await post({ idx: 0, choice: "Auburn" })).status).toBe(409);
    expect((await post({ idx: 3, choice: "Over" })).status).toBe(409);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a finished round", async () => {
    entry.answers = Array.from({ length: 5 }, (_, i) => ({ idx: i, choice: "x", correct: false }));
    expect((await post({ idx: 5, choice: "x" })).status).toBe(400);
    entry.answers = Array.from({ length: 5 }, (_, i) => ({ idx: i, choice: "x", correct: false }));
    expect((await post({ idx: 4, choice: "x" })).status).toBe(409);
  });

  /** A fat finger is not a wrong answer — the same courtesy GTG extends. */
  it("costs no answer when the choice is not on offer", async () => {
    const res = await post({ idx: 0, choice: "Clemson" });
    expect(res.status).toBe(422);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a nonsense index without touching the row", async () => {
    for (const idx of [-1, 5, 1.5, "x"]) {
      expect((await post({ idx, choice: "Auburn" })).status).toBe(400);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it("releases the score once the last answer lands", async () => {
    entry.answers = Array.from({ length: 4 }, (_, i) => ({ idx: i, choice: "x", correct: false }));
    const body = await (await post({ idx: 4, choice: "Yes" })).json();
    expect(body.done).toBe(true);
    expect(body.bug.homePoints).toBe(41);
    expect(body.bug.awayPoints).toBe(38);
  });
});

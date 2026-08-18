/**
 * Chains' route test. Routes are the coverage gap GTG-1 and GTG-3 both hid in
 * (`docs/STATUS.md` §23 #42), and this route carries the one property the pure
 * test cannot reach: the card in play comes from the STORED run, never from
 * the request, because a client-supplied cursor is a client-supplied score.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_RUN, chainsWinner, type ChainsCard } from "../../../lib/chains";

const getUser = vi.fn();
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const upsert = vi.fn();
vi.mock("../../../lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => ({ upsert }) }),
}));

const state = { deck: [] as ChainsCard[], run: { ...EMPTY_RUN }, hasDay: true };

vi.mock("../../../lib/chains-data", () => ({
  fetchChainsDay: async () => (state.hasDay ? { deck: state.deck, crests: {} } : null),
  fetchChainsRun: async () => state.run,
  fetchChainsStanding: async () => ({
    lastDay: null,
    streak: 0,
    bestStreak: 0,
    best: null,
    dist: [],
    played: 0,
    won: 0,
  }),
}));

const card = (i: number): ChainsCard => ({
  kind: "total_points",
  prompt: "Which game had more points?",
  left: { label: `L${i}`, sub: "", teamId: null },
  right: { label: `R${i}`, sub: "", teamId: null },
  leftValue: 10 + i,
  rightValue: 90 - i,
  answer: chainsWinner("total_points", 10 + i, 90 - i),
});

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/chains", {
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
  state.deck = Array.from({ length: 5 }, (_, i) => card(i));
  state.run = { ...EMPTY_RUN, answers: [] };
  state.hasDay = true;
});

afterEach(() => vi.clearAllMocks());

describe("GET /api/chains", () => {
  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await get()).status).toBe(401);
  });

  it("says so honestly when there is no run", async () => {
    state.hasDay = false;
    expect((await get()).status).toBe(404);
  });

  /**
   * The property that IS the game. Shipping the deck would not merely spoil an
   * answer, it would end the run — so the wire is checked for every card the
   * player has not reached.
   */
  it("puts only the card in play on the wire", async () => {
    const body = await (await get()).text();
    expect(body).toContain("L0");
    for (const ahead of ["L1", "L2", "L3", "L4"]) expect(body).not.toContain(ahead);
  });

  it("does not put the numbers on the wire either", async () => {
    const body = await (await get()).json();
    expect(JSON.stringify(body.current)).not.toContain("leftValue");
    expect(body.current.idx).toBe(0);
  });
});

describe("POST /api/chains", () => {
  it("extends the run on a correct call", async () => {
    const body = await (await post({ idx: 0, choice: state.deck[0]!.answer })).json();
    expect(body.length).toBe(1);
    expect(body.busted).toBe(false);
    expect(body.done).toBe(false);
  });

  it("ends the run on a miss and hands over the rest of the deck", async () => {
    const wrong = state.deck[0]!.answer === "left" ? "right" : "left";
    const body = await (await post({ idx: 0, choice: wrong })).json();
    expect(body.busted).toBe(true);
    expect(body.done).toBe(true);
    // The payoff: "you stopped on card one, here is what the rest were."
    expect(body.rest.length).toBe(state.deck.length - 1);
  });

  /**
   * The card in play is the run's own length. A replayed or reordered request
   * cannot re-answer a card, and cannot skip to one further down the deck.
   */
  it("refuses a card that is not the one in play", async () => {
    state.run = { ...EMPTY_RUN, length: 2, answers: [] };
    expect((await post({ idx: 0, choice: "left" })).status).toBe(409);
    expect((await post({ idx: 4, choice: "left" })).status).toBe(409);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a run that is already over", async () => {
    state.run = { ...EMPTY_RUN, length: 1, busted: true, ended_at: "2026-08-18T00:00:00Z" };
    expect((await post({ idx: 1, choice: "left" })).status).toBe(409);
  });

  it("refuses a side that is not a side", async () => {
    expect((await post({ idx: 0, choice: "middle" })).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  /**
   * A cleared deck must still write `ended_at`, or the best possible result
   * drops out of a board that counts ended runs.
   */
  it("ends and records a run that clears the deck", async () => {
    state.run = {
      ...EMPTY_RUN,
      length: 4,
      answers: Array.from({ length: 4 }, (_, i) => ({
        idx: i,
        choice: "left" as const,
        correct: true,
      })),
    };
    const body = await (await post({ idx: 4, choice: state.deck[4]!.answer })).json();
    expect(body.done).toBe(true);
    expect(body.busted).toBe(false);
    expect(upsert.mock.calls[0]![0].ended_at).not.toBeNull();
  });
});

/**
 * Chains practice. The property here is that the run is REPLAYED, not claimed:
 * the server holds the deck, so it stops at the first miss itself rather than
 * trusting a length the client sends.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainsWinner, type ChainsCard } from "../../../../lib/chains";

const getUser = vi.fn();
vi.mock("../../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("../../../../lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

const card = (i: number): ChainsCard => ({
  kind: "total_points",
  prompt: "Which game had more points?",
  left: { label: `L${i}`, sub: "", teamId: null },
  right: { label: `R${i}`, sub: "", teamId: null },
  leftValue: 10 + i,
  rightValue: 90 - i,
  answer: chainsWinner("total_points", 10 + i, 90 - i),
});
const deck = Array.from({ length: 5 }, (_, i) => card(i));
const state = { round: { id: 4, deck, crests: {} } as unknown };

vi.mock("../../../../lib/practice-data", () => ({
  fetchChainsPractice: async () => state.round,
}));

const get = async (qs = "") => {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/chains/practice${qs}`) as never);
};
const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/chains/practice", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
  );
};

const right = (i: number) => deck[i]!.answer;
const wrong = (i: number) => (deck[i]!.answer === "left" ? "right" : "left");

beforeEach(() => {
  vi.resetModules();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  state.round = { id: 4, deck, crests: {} };
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/chains/practice", () => {
  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await get()).status).toBe(401);
  });

  it("says so when the pool is empty", async () => {
    state.round = null;
    expect((await get()).status).toBe(404);
  });

  /** Practice inherits the daily's one-card-at-a-time cut by sharing chainsPayload. */
  it("puts only the first card on the wire", async () => {
    const raw = await (await get()).text();
    expect(raw).toContain("L0");
    for (const ahead of ["L1", "L2", "L3", "L4"]) expect(raw).not.toContain(ahead);
  });

  /**
   * The GET takes no progress, which closes the hole its first draft had: a
   * `length=` parameter would have let anyone skip to the end and read the deck.
   */
  it("ignores any attempt to declare a run length on the URL", async () => {
    const raw = await (await get("?length=5&busted=1")).text();
    for (const ahead of ["L1", "L2", "L3", "L4"]) expect(raw).not.toContain(ahead);
  });
});

describe("POST /api/chains/practice", () => {
  it("extends the run on a correct call", async () => {
    const body = await (await post({ id: 4, choices: [right(0)] })).json();
    expect(body.length).toBe(1);
    expect(body.busted).toBe(false);
  });

  it("ends the run on a miss and reveals the tail", async () => {
    const body = await (await post({ id: 4, choices: [wrong(0)] })).json();
    expect(body.busted).toBe(true);
    expect(body.done).toBe(true);
    expect(body.rest.length).toBe(deck.length - 1);
  });

  /**
   * The replay stops at the first miss, so anything sent after a bust is ignored
   * rather than trusted — a client cannot pad its way past one.
   */
  it("does not continue the run past a bust", async () => {
    const body = await (
      await post({ id: 4, choices: [right(0), wrong(1), right(2), right(3)] })
    ).json();
    expect(body.length).toBe(1);
    expect(body.busted).toBe(true);
  });

  it("clears the deck when every call is right", async () => {
    const body = await (
      await post({ id: 4, choices: deck.map((_, i) => right(i)) })
    ).json();
    expect(body.length).toBe(deck.length);
    expect(body.busted).toBe(false);
    expect(body.done).toBe(true);
  });

  it("refuses a side that is not a side", async () => {
    expect((await post({ id: 4, choices: ["middle"] })).status).toBe(400);
  });

  it("refuses more calls than the deck has cards", async () => {
    expect(
      (await post({ id: 4, choices: Array.from({ length: 9 }, () => "left") })).status,
    ).toBe(400);
  });
});

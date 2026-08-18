/**
 * The practice routes' test.
 *
 * The property worth the most here is **the absence of a write**. "Practice
 * cannot touch your record" is only true because these files contain no INSERT,
 * UPDATE or DELETE — so the first test reads the source and asserts that,
 * because it is the one claim a mocked request cannot demonstrate and the one a
 * future edit is most likely to break by accident.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTape, type TapeCtx } from "../../../../lib/tape";

const getUser = vi.fn();
vi.mock("../../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("../../../../lib/supabase/service", () => ({
  createServiceClient: () => ({}),
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
const questions = buildTape(ctx);

const round = {
  id: 7,
  fixture: {
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
  },
  questions,
  crests: {},
};
const state = { round: round as unknown };

vi.mock("../../../../lib/practice-data", () => ({
  fetchTapePractice: async () => state.round,
}));

const get = async (qs = "") => {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/tape/practice${qs}`) as never);
};
const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/tape/practice", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
  );
};

beforeEach(() => {
  vi.resetModules();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  state.round = round;
});
afterEach(() => vi.clearAllMocks());

describe("the practice routes contain no write path", () => {
  /**
   * THE test. Practice progress is supplied by the client, which is only safe
   * because nothing is scored — and that stops being true the moment one of
   * these files learns to write. Asserted against the source rather than
   * against behaviour, because a write added down an untested branch would pass
   * every behavioural test in this file.
   */
  const routes = [
    "src/app/api/tape/practice/route.ts",
    "src/app/api/chains/practice/route.ts",
    "src/app/api/depth-chart/practice/route.ts",
  ];

  for (const rel of routes) {
    it(`${rel} never inserts, updates, upserts or deletes`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      // Strip comments so the prose explaining the rule cannot trip it.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/^\s*\*.*$/gm, "");
      for (const verb of ["insert(", "upsert(", "update(", "delete(", "rpc("]) {
        expect(code, `${rel} must not call ${verb}`).not.toContain(verb);
      }
    });
  }
});

describe("GET /api/tape/practice", () => {
  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await get()).status).toBe(401);
  });

  it("says so when the pool is empty rather than erroring", async () => {
    state.round = null;
    expect((await get()).status).toBe(404);
  });

  it("serves a fresh round at question one", async () => {
    const body = await (await get()).json();
    expect(body.practiceId).toBe(7);
    expect(body.current.idx).toBe(0);
    expect(body.answered).toBe(0);
  });

  /** Practice gets the daily's spoiler-cutting for free by sharing tapePayload. */
  it("withholds the score exactly as the daily does", async () => {
    const raw = await (await get()).text();
    expect(raw).not.toContain("41");
    expect(raw).not.toContain("38");
  });

  it("rejects a non-numeric id", async () => {
    expect((await get("?id=abc")).status).toBe(400);
  });
});

describe("POST /api/tape/practice", () => {
  it("grades server-side and returns the full round state", async () => {
    const body = await (await post({ id: 7, choices: [questions[0]!.answer] })).json();
    expect(body.history[0].correct).toBe(true);
    expect(body.answered).toBe(1);
    expect(body.current.idx).toBe(1);
  });

  it("marks a wrong answer wrong", async () => {
    const wrong = questions[0]!.choices.find((c) => c !== questions[0]!.answer)!;
    const body = await (await post({ id: 7, choices: [wrong] })).json();
    expect(body.history[0].correct).toBe(false);
  });

  /**
   * The client sends its whole list and the server re-grades all of it, so the
   * history shown is the server's rather than a set of claims.
   */
  it("re-grades the whole submitted list", async () => {
    const wrong = questions[0]!.choices.find((c) => c !== questions[0]!.answer)!;
    const body = await (
      await post({ id: 7, choices: [wrong, questions[1]!.answer] })
    ).json();
    expect(body.history.map((h: { correct: boolean }) => h.correct)).toEqual([false, true]);
  });

  it("releases the score once the last answer lands", async () => {
    const body = await (
      await post({ id: 7, choices: questions.map((q) => q.answer) })
    ).json();
    expect(body.done).toBe(true);
    expect(body.correct).toBe(questions.length);
    expect(body.bug.homePoints).toBe(41);
  });

  /** A fat finger costs nothing here either. */
  it("refuses a choice that is not on offer", async () => {
    expect((await post({ id: 7, choices: ["Clemson"] })).status).toBe(422);
  });

  it("rejects a nonsense body", async () => {
    expect((await post({ id: "x", choices: ["a"] })).status).toBe(400);
    expect((await post({ id: 7, choices: [] })).status).toBe(400);
  });
});

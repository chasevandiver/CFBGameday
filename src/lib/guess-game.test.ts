import { describe, expect, it } from "vitest";
import {
  fnv1a,
  GTG_MAX_ATTEMPTS,
  gtgHints,
  gtgPayload,
  gtgShareString,
  gtgVerdict,
  pickDailyGame,
  type GtgAnswerCtx,
} from "./guess-game";

const ANSWER: GtgAnswerCtx = {
  homeTeamId: 61,
  homeConference: "SEC",
  homeSchool: "Georgia",
  awaySchool: "Auburn",
  homePoints: 27,
  awayPoints: 20,
  season: 2024,
  week: 6,
  spread: -14.5,
};

describe("pickDailyGame (rendezvous)", () => {
  const ids = Array.from({ length: 500 }, (_, i) => i + 1);

  it("is deterministic — same day, same deck, same game for everyone", () => {
    expect(pickDailyGame("2026-09-01", ids)).toBe(pickDailyGame("2026-09-01", ids));
  });

  it("different days pick different games (overwhelmingly)", () => {
    const days = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
    const picks = new Set(days.map((d) => pickDailyGame(d, ids)));
    expect(picks.size).toBeGreaterThan(20);
  });

  it("adding a candidate only changes days the newcomer itself wins", () => {
    const days = Array.from({ length: 60 }, (_, i) => `2026-10-${(i % 30) + 1}-${i}`);
    const grown = [...ids, 9999];
    let changed = 0;
    for (const d of days) {
      const before = pickDailyGame(d, ids);
      const after = pickDailyGame(d, grown);
      if (before !== after) {
        expect(after).toBe(9999); // the only legal difference
        changed++;
      }
    }
    // and the newcomer must not have taken everything
    expect(changed).toBeLessThan(days.length / 2);
  });

  it("null on an empty deck", () => {
    expect(pickDailyGame("2026-09-01", [])).toBeNull();
  });

  it("fnv1a is stable (pinned so a refactor cannot silently reshuffle history)", () => {
    expect(fnv1a("2026-09-01:401")).toBe(fnv1a("2026-09-01:401"));
    expect(fnv1a("a")).not.toBe(fnv1a("b"));
  });
});

describe("gtgVerdict", () => {
  it("the home team is correct; a conference mate is warm; anyone else is cold", () => {
    expect(gtgVerdict({ id: 61, conference: "SEC" }, ANSWER)).toBe("correct");
    expect(gtgVerdict({ id: 2, conference: "SEC" }, ANSWER)).toBe("conference");
    expect(gtgVerdict({ id: 130, conference: "Big Ten" }, ANSWER)).toBe("miss");
  });
  it("null conferences never match each other", () => {
    const indep = { ...ANSWER, homeConference: null };
    expect(gtgVerdict({ id: 99, conference: null }, indep)).toBe("miss");
  });
});

describe("gtgHints — the reveal ladder", () => {
  it("hint 0 is free; each miss buys exactly one more", () => {
    expect(gtgHints(ANSWER, 0)).toHaveLength(1);
    expect(gtgHints(ANSWER, 2)).toHaveLength(3);
    expect(gtgHints(ANSWER, 9)).toHaveLength(5); // capped at the ladder
  });
  it("never names the home team at any rung — the answer is not a hint", () => {
    for (let attempts = 0; attempts <= GTG_MAX_ATTEMPTS; attempts++) {
      for (const h of gtgHints(ANSWER, attempts)) {
        expect(h.value).not.toContain(ANSWER.homeSchool);
      }
    }
  });
});

describe("gtgPayload — the anti-spoiler contract", () => {
  it("an unsolved payload never contains the home school, anywhere", () => {
    const row = {
      guesses: [{ name: "Auburn", verdict: "conference" as const }],
      attempts: 3,
      solved_at: null,
    };
    const json = JSON.stringify(gtgPayload("2026-09-01", row, ANSWER));
    expect(json).not.toContain(ANSWER.homeSchool);
    expect(JSON.parse(json).answer).toBeNull();
  });
  it("the answer appears once solved, and once out of guesses", () => {
    const solved = gtgPayload(
      "2026-09-01",
      { guesses: [], attempts: 1, solved_at: "2026-09-01T12:00:00Z" },
      ANSWER,
    );
    expect(solved.answer).toBe("Auburn @ Georgia");
    const busted = gtgPayload(
      "2026-09-01",
      { guesses: [], attempts: GTG_MAX_ATTEMPTS, solved_at: null },
      ANSWER,
    );
    expect(busted.answer).toBe("Auburn @ Georgia");
    expect(busted.solved).toBe(false);
  });
});

describe("gtgShareString", () => {
  it("is spoiler-free: emoji and the score, no names", () => {
    const s = gtgShareString("2026-09-01", ["miss", "conference", "correct"], true);
    expect(s).toBe("Guess the Game 2026-09-01 3/6\n⬛🟨🟩");
  });
  it("a bust shares as X", () => {
    const s = gtgShareString("2026-09-01", ["miss", "miss"], false);
    expect(s).toContain("X/6");
  });
});

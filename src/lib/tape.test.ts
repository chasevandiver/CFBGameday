import { describe, expect, it } from "vitest";
import {
  TAPE_PRIORITY,
  TAPE_QUESTIONS,
  askTape,
  buildTape,
  canAsk,
  marginBand,
  spreadBand,
  tapeEligible,
  tapePayload,
  tapeScore,
  tapeShareBlock,
  tapeStanding,
  type TapeAnswer,
  type TapeCtx,
  type TapeFixture,
} from "./tape";

const ctx = (over: Partial<TapeCtx> = {}): TapeCtx => ({
  homeSchool: "Auburn",
  awaySchool: "Alabama",
  homePoints: 34,
  awayPoints: 28,
  season: 2013,
  week: 14,
  seasonType: "regular",
  neutralSite: false,
  conferenceGame: true,
  spread: 10.5,
  total: 55.5,
  pollPublished: true,
  homeRank: 4,
  ...over,
});

const fixture = (over: Partial<TapeFixture> = {}): TapeFixture => ({
  season: 2013,
  week: 14,
  seasonType: "regular",
  neutralSite: false,
  homeSchool: "Auburn",
  awaySchool: "Alabama",
  homeTeamId: 2,
  awayTeamId: 333,
  homePoints: 34,
  awayPoints: 28,
  ...over,
});

describe("bands", () => {
  it("splits the spread at the numbers a bettor would", () => {
    expect(spreadBand(3)).toBe("1–3");
    expect(spreadBand(3.5)).toBe("3.5–7");
    expect(spreadBand(7)).toBe("3.5–7");
    expect(spreadBand(7.5)).toBe("7.5–14");
    expect(spreadBand(14)).toBe("7.5–14");
    expect(spreadBand(14.5)).toBe("14+");
  });

  it("reads a band off either side of the line", () => {
    expect(spreadBand(-10.5)).toBe(spreadBand(10.5));
  });

  it("splits the margin at one and two scores", () => {
    expect(marginBand(7)).toBe("1–7");
    expect(marginBand(8)).toBe("8–14");
    expect(marginBand(15)).toBe("15+");
    expect(marginBand(-21)).toBe("15+");
  });
});

describe("canAsk", () => {
  it("always allows the questions a final score alone settles", () => {
    const bare = ctx({ spread: null, total: null, pollPublished: false });
    for (const k of [
      "winner",
      "margin_band",
      "combined_band",
      "conference_game",
      "thirty_plus",
    ] as const) {
      expect(canAsk(k, bare)).toBe(true);
    }
  });

  it("refuses the market questions with no line", () => {
    expect(canAsk("favourite", ctx({ spread: null }))).toBe(false);
    expect(canAsk("spread_band", ctx({ spread: null }))).toBe(false);
  });

  /** A pick'em has no favourite, so "who was favoured" has no true answer. */
  it("refuses the market questions on a pick'em", () => {
    expect(canAsk("favourite", ctx({ spread: 0 }))).toBe(false);
    expect(canAsk("spread_band", ctx({ spread: 0 }))).toBe(false);
  });

  it("refuses over/under with no total", () => {
    expect(canAsk("total", ctx({ total: null }))).toBe(false);
  });

  /**
   * A game that landed exactly on the number is a push. Six-pack voids that
   * case; a round with no void slot has to refuse it at generation instead.
   */
  it("refuses over/under when the game landed on the number", () => {
    expect(canAsk("total", ctx({ homePoints: 30, awayPoints: 25, total: 55 }))).toBe(false);
    expect(canAsk("total", ctx({ homePoints: 30, awayPoints: 25, total: 55.5 }))).toBe(true);
  });

  /**
   * The distinction the whole `pollPublished` flag exists for: "we found no
   * rank" and "nobody was ranked this week" look identical, and only the first
   * one means unranked. Answering "no" in week 0 states a fact nobody checked.
   */
  it("refuses the poll question when no poll was published that week", () => {
    expect(canAsk("home_ranked", ctx({ pollPublished: false, homeRank: null }))).toBe(false);
    expect(canAsk("home_ranked", ctx({ pollPublished: true, homeRank: null }))).toBe(true);
  });

  it("refuses a winner on a tie", () => {
    expect(canAsk("winner", ctx({ homePoints: 21, awayPoints: 21 }))).toBe(false);
  });
});

describe("askTape", () => {
  it("answers the winner from the score", () => {
    expect(askTape("winner", ctx()).answer).toBe("Auburn");
    expect(askTape("winner", ctx({ homePoints: 10, awayPoints: 20 })).answer).toBe("Alabama");
  });

  /** Negative means home favoured — the convention everywhere in this codebase. */
  it("reads the favourite off the sign of the spread", () => {
    expect(askTape("favourite", ctx({ spread: -10.5 })).answer).toBe("Auburn");
    expect(askTape("favourite", ctx({ spread: 10.5 })).answer).toBe("Alabama");
  });

  it("prints the real total in the prompt so nobody has to guess the number", () => {
    expect(askTape("total", ctx({ total: 55.5 })).prompt).toContain("55.5");
  });

  it("answers the poll question from the rank, not from the publication flag", () => {
    expect(askTape("home_ranked", ctx({ homeRank: 4 })).answer).toBe("Yes");
    expect(askTape("home_ranked", ctx({ homeRank: null })).answer).toBe("No");
  });

  it("always offers its own answer as a choice", () => {
    for (const kind of TAPE_PRIORITY) {
      const q = askTape(kind, ctx());
      expect(q.choices, `${kind} must offer its answer`).toContain(q.answer);
    }
  });

  /**
   * A question with a made-up answer is the single failure this design exists
   * to prevent, so an unaskable kind throws rather than degrading.
   */
  it("throws rather than inventing an answer it cannot compute", () => {
    expect(() => askTape("favourite", ctx({ spread: null }))).toThrow(/cannot ask/);
  });
});

describe("buildTape", () => {
  it("builds the five the round is designed around", () => {
    expect(buildTape(ctx()).map((q) => q.kind)).toEqual([
      "winner",
      "favourite",
      "spread_band",
      "total",
      "home_ranked",
    ]);
  });

  it("is always exactly five", () => {
    expect(buildTape(ctx())).toHaveLength(TAPE_QUESTIONS);
  });

  /**
   * The reserves are belt-and-braces: the deck filter should mean they are
   * never reached, but "a round is always five questions" has to be a property
   * of the code and not of the deck query being right.
   */
  it("falls back to reserves rather than shipping a short round", () => {
    const noMarket = ctx({ spread: null, total: null, pollPublished: false });
    const kinds = buildTape(noMarket).map((q) => q.kind);
    expect(kinds).toHaveLength(TAPE_QUESTIONS);
    expect(kinds).toContain("margin_band");
    expect(kinds).toContain("conference_game");
  });

  /**
   * The reserve bank was one question short when this test was first written —
   * with no market and no poll, only four kinds were askable and `buildTape`
   * threw on a game the deck filter would happily have offered. That is
   * exactly the failure the belt exists to catch, and it is why the reserves
   * are tested against a game stripped of everything rather than against a
   * realistic one.
   */
  it("throws rather than writing a short round", () => {
    // A tie kills BOTH margin-band and winner, leaving three askable.
    const tie = ctx({
      homePoints: 21,
      awayPoints: 21,
      spread: null,
      total: null,
      pollPublished: false,
    });
    expect(() => buildTape(tie)).toThrow(/only \d+ askable/);
  });
});

describe("tapeEligible", () => {
  it("wants all five headline questions, not five of any kind", () => {
    expect(tapeEligible(ctx())).toBe(true);
    expect(tapeEligible(ctx({ spread: null }))).toBe(false);
    expect(tapeEligible(ctx({ total: null }))).toBe(false);
    expect(tapeEligible(ctx({ pollPublished: false }))).toBe(false);
  });
});

/* ---- the payload, and what it must not carry ---------------------------- */

const answers = (n: number): TapeAnswer[] =>
  Array.from({ length: n }, (_, i) => ({ idx: i, choice: "x", correct: false }));

describe("tapePayload", () => {
  const qs = buildTape(ctx());

  /**
   * THE test. A score of 41–38 is distinctive enough that finding either
   * numeral anywhere in the payload is proof of a leak, and the loop covers
   * every progress value rather than the one the author happened to try.
   *
   * Note what this does NOT claim. The Tape names the fixture, so every fact
   * about it is public — anon-readable in this database and on the open
   * internet besides. This is not Guess the Game's anti-spoiler property; it
   * is the weaker and still worthwhile promise that the page does not hand the
   * answer over for free.
   */
  it("never carries the final score before the round is over", () => {
    const f = fixture({ homePoints: 41, awayPoints: 38 });
    for (let n = 0; n < TAPE_QUESTIONS; n++) {
      const json = JSON.stringify(
        tapePayload("2026-08-18", f, qs, { answers: answers(n), completed_at: null }),
      );
      expect(json, `leaked at ${n} answered`).not.toContain("41");
      expect(json, `leaked at ${n} answered`).not.toContain("38");
    }
  });

  it("releases both numerals together, and only when done", () => {
    const f = fixture({ homePoints: 41, awayPoints: 38 });
    const before = tapePayload("2026-08-18", f, qs, { answers: answers(4), completed_at: null });
    expect(before.bug.homePoints).toBeNull();
    expect(before.bug.awayPoints).toBeNull();

    const after = tapePayload("2026-08-18", f, qs, {
      answers: answers(5),
      completed_at: "2026-08-18T12:00:00Z",
    });
    expect(after.bug.homePoints).toBe(41);
    expect(after.bug.awayPoints).toBe(38);
  });

  /**
   * Shipping the whole list would let a player read question five before
   * answering question one, and the chain between them is most of what makes
   * the round interesting.
   */
  it("ships one question at a time and no future answers", () => {
    for (let n = 0; n < TAPE_QUESTIONS; n++) {
      const p = tapePayload("2026-08-18", fixture(), qs, {
        answers: answers(n),
        completed_at: null,
      });
      expect(p.current?.idx).toBe(n);
      expect(p.history).toHaveLength(n);
      const json = JSON.stringify(p);
      for (const future of qs.slice(n + 1)) {
        expect(json, `question after ${n} leaked`).not.toContain(future.prompt);
      }
    }
  });

  it("names the winner once question one has been answered, and not before", () => {
    const at0 = tapePayload("2026-08-18", fixture(), qs, { answers: [], completed_at: null });
    expect(at0.bug.winner).toBeNull();
    const at1 = tapePayload("2026-08-18", fixture(), qs, {
      answers: answers(1),
      completed_at: null,
    });
    expect(at1.bug.winner).toBe("Auburn");
  });

  it("names the fixture from the start — that is the hook", () => {
    const p = tapePayload("2026-08-18", fixture(), qs, { answers: [], completed_at: null });
    expect(p.fixture.homeSchool).toBe("Auburn");
    expect(p.fixture.awaySchool).toBe("Alabama");
    expect(p.fixture.season).toBe(2013);
  });

  it("withholds the score until the round is done", () => {
    const p = tapePayload("2026-08-18", fixture(), qs, { answers: answers(3), completed_at: null });
    expect(p.correct).toBeNull();
    expect(p.done).toBe(false);
  });
});

describe("tapeScore", () => {
  const graded = (correct: number): TapeAnswer[] =>
    Array.from({ length: TAPE_QUESTIONS }, (_, i) => ({
      idx: i,
      choice: "x",
      correct: i < correct,
    }));

  it("pays one a correct answer", () => {
    expect(tapeScore(graded(3))).toBe(3);
  });

  it("pays a bonus for the clean sheet", () => {
    expect(tapeScore(graded(5))).toBeGreaterThan(tapeScore(graded(4)) + 1);
  });

  it("pays nothing for a partial round", () => {
    expect(tapeScore([])).toBe(0);
  });
});

describe("tapeShareBlock", () => {
  const graded: TapeAnswer[] = [
    { idx: 0, choice: "a", correct: true },
    { idx: 1, choice: "b", correct: false },
    { idx: 2, choice: "c", correct: true },
    { idx: 3, choice: "d", correct: true },
    { idx: 4, choice: "e", correct: true },
  ];

  it("gives away nothing to somebody who has not played", () => {
    const block = tapeShareBlock("2026-08-18", graded, 4);
    for (const leak of ["Auburn", "Alabama", "34", "28", "Who won", "ranked"]) {
      expect(block).not.toContain(leak);
    }
  });

  it("shows which ones were missed, not just how many", () => {
    const block = tapeShareBlock("2026-08-18", graded);
    expect(block).toContain("🟩⬛🟩🟩🟩");
    expect(block).toContain("4/5");
  });

  it("drops the streak footer rather than bragging about zero", () => {
    expect(tapeShareBlock("2026-08-18", graded, 0)).not.toContain("Streak");
  });
});

describe("tapeStanding", () => {
  it("extends a streak only on a clean sheet", () => {
    const s = tapeStanding([
      { day: "2026-08-16", correct: 5 },
      { day: "2026-08-17", correct: 5 },
      { day: "2026-08-18", correct: 4 },
    ]);
    expect(s.bestStreak).toBe(2);
    expect(s.streak).toBe(0);
  });

  /** The sort is inside the fold because a newest-first feed fails silently. */
  it("survives rows arriving newest first", () => {
    const s = tapeStanding([
      { day: "2026-08-18", correct: 5 },
      { day: "2026-08-16", correct: 5 },
      { day: "2026-08-17", correct: 5 },
    ]);
    expect(s.played).toBe(3);
    expect(s.streak).toBe(3);
  });

  it("restarts rather than continues across a gap", () => {
    const s = tapeStanding([
      { day: "2026-08-14", correct: 5 },
      { day: "2026-08-18", correct: 5 },
    ]);
    expect(s.streak).toBe(1);
  });
});

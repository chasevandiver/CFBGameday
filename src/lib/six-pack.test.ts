import { describe, expect, it } from "vitest";
import {
  choiceText,
  entryScore,
  marginBucket,
  questionText,
  rolloverWeeks,
  settle,
  type SixPackGame,
  type SixPackKind,
  type SixPackQuestion,
} from "./six-pack";

const q = (over: Partial<SixPackQuestion>): SixPackQuestion => ({
  idx: 1,
  kind: "winner",
  gameId: 401,
  line: null,
  choices: ["home", "away"],
  ...over,
});

const game = (over: Partial<SixPackGame> = {}): SixPackGame => ({
  id: 401,
  status: "final",
  homePoints: 27,
  awayPoints: 20,
  ...over,
});

describe("settle — winner", () => {
  it("settles on the scoreboard", () => {
    expect(settle(q({}), [game()])).toBe("home");
    expect(settle(q({}), [game({ homePoints: 20, awayPoints: 27 })])).toBe("away");
  });
  it("voids a tie rather than settling it against everyone", () => {
    expect(settle(q({}), [game({ homePoints: 20, awayPoints: 20 })])).toBe("void");
  });
});

describe("settle — cover", () => {
  const cover = (line: number) => q({ kind: "cover", line });
  it("uses the home-perspective line frozen on the question", () => {
    // Home -3.5, home wins by 7 → covers.
    expect(settle(cover(-3.5), [game()])).toBe("home");
    // Home -10.5, home wins by 7 → away covers.
    expect(settle(cover(-10.5), [game()])).toBe("away");
  });
  it("a push voids", () => {
    expect(settle(cover(-7), [game()])).toBe("void");
  });
  it("no line means it can never settle", () => {
    expect(settle(q({ kind: "cover", line: null }), [game()])).toBe("void");
  });
});

describe("settle — total", () => {
  it("compares the combined score to the frozen number", () => {
    expect(settle(q({ kind: "total", line: 44.5, choices: ["over", "under"] }), [game()])).toBe(
      "over",
    );
    expect(settle(q({ kind: "total", line: 52.5, choices: ["over", "under"] }), [game()])).toBe(
      "under",
    );
  });
  it("landing exactly on the number voids", () => {
    expect(settle(q({ kind: "total", line: 47, choices: ["over", "under"] }), [game()])).toBe(
      "void",
    );
  });
});

describe("settle — margin", () => {
  it("buckets the final margin", () => {
    expect(marginBucket(7)).toBe("1-7");
    expect(marginBucket(-8)).toBe("8-14");
    expect(marginBucket(21)).toBe("15+");
    expect(settle(q({ kind: "margin", choices: ["1-7", "8-14", "15+"] }), [game()])).toBe("1-7");
  });
});

describe("settle — high_game", () => {
  const hg = q({ kind: "high_game", gameId: null, choices: ["401", "402"] });
  it("picks the highest combined score once every candidate is final", () => {
    expect(
      settle(hg, [game(), game({ id: 402, homePoints: 45, awayPoints: 42 })]),
    ).toBe("402");
  });
  it("waits while any candidate is unfinished", () => {
    expect(settle(hg, [game(), game({ id: 402, status: "in_progress" })])).toBeNull();
  });
  it("a tie for highest voids — there is no single answer", () => {
    expect(
      settle(hg, [game(), game({ id: 402, homePoints: 27, awayPoints: 20 })]),
    ).toBe("void");
  });
  it("a dead candidate drops out rather than blocking the question", () => {
    expect(
      settle(hg, [game(), game({ id: 402, status: "postponed", homePoints: null, awayPoints: null })]),
    ).toBe("401");
  });
  it("every candidate dead voids", () => {
    expect(
      settle(hg, [
        game({ status: "canceled", homePoints: null, awayPoints: null }),
        game({ id: 402, status: "postponed", homePoints: null, awayPoints: null }),
      ]),
    ).toBe("void");
  });
});

describe("settle — not ready, and dead games", () => {
  it("returns null while the game is unfinished — never a guess", () => {
    expect(settle(q({}), [game({ status: "in_progress" })])).toBeNull();
    expect(settle(q({}), [game({ status: "scheduled", homePoints: null, awayPoints: null })])).toBeNull();
    expect(settle(q({}), [])).toBeNull();
  });
  it("a dead game voids every per-game kind", () => {
    const dead = game({ status: "postponed", homePoints: null, awayPoints: null });
    for (const kind of ["winner", "cover", "total", "margin"] as const) {
      expect(settle(q({ kind, line: 44.5 }), [dead])).toBe("void");
    }
  });
});

describe("settle — totality", () => {
  /**
   * The guard the closure rule needs: a kind added without a settler must
   * fail here, not ship a question nobody can grade. The compiler catches it
   * via the `never` fallthrough; this catches it at runtime too.
   */
  it("every kind either settles or voids on a finished slate", () => {
    const kinds: SixPackKind[] = ["winner", "cover", "total", "margin", "high_game"];
    for (const kind of kinds) {
      const question = q({
        kind,
        gameId: kind === "high_game" ? null : 401,
        line: 44.5,
        choices: kind === "high_game" ? ["401"] : ["home", "away"],
      });
      expect(settle(question, [game()])).not.toBeNull();
    }
  });
});

describe("entryScore", () => {
  const line = (idx: number, result: EntryResult) => ({ idx, choice: "home", result });
  type EntryResult = "correct" | "wrong" | "void" | null;

  it("counts correct against gradable", () => {
    const s = entryScore([line(1, "correct"), line(2, "correct"), line(3, "wrong")]);
    expect(s).toMatchObject({ correct: 2, gradable: 3, perfect: false, pending: 0 });
  });

  it("a void leaves BOTH counts alone — 5/5 on a five-gradable week is perfect", () => {
    const s = entryScore([
      line(1, "correct"),
      line(2, "correct"),
      line(3, "correct"),
      line(4, "correct"),
      line(5, "correct"),
      line(6, "void"),
    ]);
    expect(s.correct).toBe(5);
    expect(s.gradable).toBe(5);
    expect(s.perfect).toBe(true);
  });

  it("is not perfect while anything is pending", () => {
    const s = entryScore([line(1, "correct"), line(2, null)]);
    expect(s.perfect).toBe(false);
    expect(s.pending).toBe(1);
  });

  it("an all-void week is not a perfect week", () => {
    expect(entryScore([line(1, "void"), line(2, "void")]).perfect).toBe(false);
  });
});

describe("rolloverWeeks", () => {
  const w = (week: number, anyPerfect: boolean, complete = true) => ({ week, anyPerfect, complete });

  it("counts back to the last week somebody cleared it", () => {
    expect(rolloverWeeks([w(5, true), w(6, false), w(7, false), w(8, false)])).toBe(3);
  });
  it("is zero the week somebody clears it", () => {
    expect(rolloverWeeks([w(7, false), w(8, true)])).toBe(0);
  });
  it("ignores a week still playing — it has not failed yet", () => {
    expect(rolloverWeeks([w(7, false), w(8, false, false)])).toBe(1);
  });
  it("changes when a re-grade flips a result — the derived-not-stored proof", () => {
    const before = [w(6, false), w(7, false)];
    expect(rolloverWeeks(before)).toBe(2);
    const after = [w(6, true), w(7, false)];
    expect(rolloverWeeks(after)).toBe(1);
  });
  it("no completed weeks is zero, not a negative or a throw", () => {
    expect(rolloverWeeks([])).toBe(0);
  });
});

describe("copy", () => {
  const labels = { home: "UGA", away: "AUB" };
  it("names the fixture in every per-game question", () => {
    expect(questionText(q({}), labels)).toBe("Who wins AUB @ UGA?");
    expect(questionText(q({ kind: "total", line: 51.5 }), labels)).toContain("51.5");
    expect(questionText(q({ kind: "margin" }), labels)).toContain("AUB @ UGA");
  });
  it("renders choices as teams, sides, or fixtures", () => {
    const at = (id: number) => (id === 401 ? labels : null);
    expect(choiceText(q({}), "home", at)).toBe("UGA");
    expect(choiceText(q({}), "away", at)).toBe("AUB");
    expect(choiceText(q({ kind: "total" }), "over", at)).toBe("Over");
    expect(
      choiceText(q({ kind: "high_game", gameId: null, choices: ["401"] }), "401", at),
    ).toBe("AUB @ UGA");
  });
});

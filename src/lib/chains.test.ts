import { describe, expect, it } from "vitest";
import {
  CHAINS_DECK,
  EMPTY_RUN,
  cardGap,
  chainsOrder,
  chainsPayload,
  chainsShareBlock,
  chainsStanding,
  chainsWinner,
  isMintable,
  type ChainsCard,

} from "./chains";

const card = (over: Partial<ChainsCard> = {}): ChainsCard => {
  const base: ChainsCard = {
    kind: "total_points",
    prompt: "Which game had more points?",
    left: { label: "Alabama at Auburn", sub: "2013 · Week 14", teamId: null },
    right: { label: "Texas at Oklahoma", sub: "2018 · Week 7", teamId: null },
    leftValue: 62,
    rightValue: 93,
    answer: "right",
    ...over,
  };
  return { ...base, answer: chainsWinner(base.kind, base.leftValue, base.rightValue) };
};

describe("chainsWinner", () => {
  it("picks the bigger number when bigger wins", () => {
    expect(chainsWinner("total_points", 62, 93)).toBe("right");
    expect(chainsWinner("margin", 30, 3)).toBe("left");
    expect(chainsWinner("spread", 21, 3.5)).toBe("left");
  });

  /**
   * The inversion that ships wrong and stays wrong: a poll rank is BETTER when
   * it is lower, so #2 beats #8 and the naive comparison gets every one of
   * these cards backwards. Its own test, deliberately.
   */
  it("inverts for a poll finish, where lower is better", () => {
    expect(chainsWinner("ap_finish", 2, 8)).toBe("left");
    expect(chainsWinner("ap_finish", 14, 1)).toBe("right");
  });
});

describe("isMintable", () => {
  /**
   * Six-pack grades a push as `void`. A run has nowhere to put a void — there
   * is no slot between "kept going" and "stopped" — so a tie has to be refused
   * at generation instead.
   */
  it("refuses a card with no answer", () => {
    expect(isMintable(45, 45)).toBe(false);
    expect(isMintable(45, 46)).toBe(true);
  });
});

describe("cardGap", () => {
  it("is near zero for two numbers a point apart", () => {
    expect(cardGap(card({ leftValue: 45, rightValue: 46 }))).toBeLessThan(0.1);
  });

  it("caps at one so an absurd pairing cannot dominate", () => {
    expect(cardGap(card({ leftValue: 3, rightValue: 900 }))).toBe(1);
  });

  /**
   * Gaps are normalised per kind, which is the point: 14 points of spread and
   * 14 points of scoring are very different amounts of obvious, and ordering on
   * raw differences would put every scoring card first.
   */
  it("normalises across kinds", () => {
    const scoring = cardGap({ kind: "total_points", leftValue: 40, rightValue: 54 });
    const spread = cardGap({ kind: "spread", leftValue: 3, rightValue: 17 });
    expect(spread).toBeGreaterThan(scoring);
  });
});

describe("chainsOrder", () => {
  /**
   * THE load-bearing property. A run of coin flips is a geometric random
   * variable and says nothing about the player; ordering easiest-first is what
   * turns run length into a ladder.
   */
  it("puts the widest gap first and the coin flip last", () => {
    const deck = chainsOrder([
      card({ leftValue: 45, rightValue: 46 }),
      card({ leftValue: 20, rightValue: 80 }),
      card({ leftValue: 40, rightValue: 52 }),
    ]);
    const gaps = deck.map(cardGap);
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i - 1]!).toBeGreaterThanOrEqual(gaps[i]!);
    }
  });

  /**
   * A total order matters more here than it looks: the same day must produce
   * the same run for everybody, and two cards with equal gaps must not depend
   * on the order the generator happened to build them in.
   */
  it("is a total order, so the same deck always sorts the same way", () => {
    const a = card({ left: { label: "A", sub: "", teamId: null }, leftValue: 10, rightValue: 30 });
    const b = card({ left: { label: "B", sub: "", teamId: null }, leftValue: 30, rightValue: 10 });
    expect(chainsOrder([a, b]).map((c) => c.left.label)).toEqual(["A", "B"]);
    expect(chainsOrder([b, a]).map((c) => c.left.label)).toEqual(["A", "B"]);
  });

  it("does not mutate its input", () => {
    const deck = [card({ leftValue: 45, rightValue: 46 }), card({ leftValue: 20, rightValue: 80 })];
    chainsOrder(deck);
    expect(deck[0]!.leftValue).toBe(45);
  });
});

describe("chainsPayload", () => {
  const deck = Array.from({ length: 6 }, (_, i) =>
    card({ leftValue: 10 + i, rightValue: 90 - i, left: { label: `L${i}`, sub: "", teamId: null } }),
  );

  /**
   * Shipping the whole deck is the obvious way to ruin this game: a player who
   * can read card five before answering card one has a list, not a run. The
   * loop checks every position rather than the one the author happened to try.
   */
  it("never ships a card the run has not reached", () => {
    for (let length = 0; length < deck.length; length++) {
      const json = JSON.stringify(
        chainsPayload("2026-08-18", deck, { ...EMPTY_RUN, length, answers: played(length) }),
      );
      for (let ahead = length + 1; ahead < deck.length; ahead++) {
        expect(json, `card ${ahead} leaked at length ${length}`).not.toContain(`"L${ahead}"`);
      }
    }
  });

  it("never ships the numbers behind the card in play", () => {
    const p = chainsPayload("2026-08-18", deck, { ...EMPTY_RUN, length: 2, answers: played(2) });
    expect(p.current).not.toBeNull();
    expect(JSON.stringify(p.current)).not.toContain("leftValue");
    expect(JSON.stringify(p.current)).not.toContain("answer");
  });

  it("reveals the numbers behind a card once it has been played", () => {
    const p = chainsPayload("2026-08-18", deck, { ...EMPTY_RUN, length: 1, answers: played(1) });
    expect(p.played[0]!.leftValue).toBe(10);
    expect(p.played[0]!.answer).toBe("right");
  });

  /**
   * The payoff, not a leak: "you stopped on card three, here is what four
   * through twenty were" is the reason to come back — and it can only be shown
   * once there is nothing left to protect.
   */
  it("shows the rest of the deck only once the run is over", () => {
    const live = chainsPayload("2026-08-18", deck, { ...EMPTY_RUN, length: 3, answers: played(3) });
    expect(live.rest).toEqual([]);

    const bust = chainsPayload("2026-08-18", deck, {
      ...EMPTY_RUN,
      length: 3,
      busted: true,
      answers: [...played(3), { idx: 3, choice: "left", correct: false }],
      ended_at: "2026-08-18T12:00:00Z",
    });
    expect(bust.done).toBe(true);
    expect(bust.rest.length).toBe(deck.length - 4);
  });

  it("is done when the deck runs out, even without a bust", () => {
    const p = chainsPayload("2026-08-18", deck, {
      ...EMPTY_RUN,
      length: deck.length,
      answers: played(deck.length),
    });
    expect(p.done).toBe(true);
    expect(p.current).toBeNull();
  });
});

const played = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ idx: i, choice: "right" as const, correct: true }));

describe("chainsShareBlock", () => {
  it("says how far you got without naming a game", () => {
    const block = chainsShareBlock(
      "2026-08-18",
      { ...EMPTY_RUN, length: 3, busted: true, answers: [...played(3), { idx: 3, choice: "left", correct: false }] },
      9,
    );
    expect(block).toContain("🟩🟩🟩🟥");
    expect(block).toContain("Best 9");
    for (const leak of ["Alabama", "Auburn", "Texas", "62", "93"]) {
      expect(block).not.toContain(leak);
    }
  });

  it("drops the footer rather than bragging about zero", () => {
    expect(chainsShareBlock("2026-08-18", EMPTY_RUN, 0)).not.toContain("Best");
  });
});

describe("chainsStanding", () => {
  /**
   * A win is clearing the whole deck, deliberately rare. Chains' currency is
   * the run length — a streak that moved every day would be measuring
   * attendance rather than skill.
   */
  it("counts a win only when the deck is cleared", () => {
    const s = chainsStanding([
      { day: "2026-08-17", length: 19, deckSize: CHAINS_DECK },
      { day: "2026-08-18", length: 20, deckSize: CHAINS_DECK },
    ]);
    expect(s.won).toBe(1);
    expect(s.best).toBe(20);
  });

  it("keeps the best run even when today was short", () => {
    const s = chainsStanding([
      { day: "2026-08-17", length: 14, deckSize: CHAINS_DECK },
      { day: "2026-08-18", length: 2, deckSize: CHAINS_DECK },
    ]);
    expect(s.best).toBe(14);
  });
});

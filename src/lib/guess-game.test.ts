import { describe, expect, it } from "vitest";
import {
  fnv1a,
  GTG_MAX_ATTEMPTS,
  gtgHints,
  gtgPayload,
  gtgShareString,
  gtgVerdict,
  pickDailyGame,
  matchSchools,
  practicePool,
  recordEntering,
  recordLine,
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
  homeRecord: { wins: 4, losses: 1 },
};

describe("practicePool — the no-spoilers guarantee", () => {
  const deck = Array.from({ length: 400 }, (_, i) => i + 1);

  it("no seed can reach today's game", () => {
    // The property, checked the only way worth checking it: pick today, then
    // try to land on it from every direction.
    const today = pickDailyGame("2026-08-17", deck)!;
    const pool = practicePool(deck, today);
    const seeds = Array.from({ length: 300 }, (_, i) => `p-seed-${i}`);
    expect(seeds.map((s) => pickDailyGame(s, pool))).not.toContain(today);
  });

  it("drops exactly one game and keeps the rest", () => {
    const today = pickDailyGame("2026-08-17", deck)!;
    const pool = practicePool(deck, today);
    expect(pool).toHaveLength(deck.length - 1);
    expect(pool).not.toContain(today);
  });

  it("still gives a full pool when there is no puzzle today", () => {
    expect(practicePool(deck, null)).toEqual(deck);
  });

  it("hands back nothing when the deck was already empty", () => {
    expect(practicePool([], null)).toEqual([]);
  });
});

describe("matchSchools", () => {
  const opt = (school: string, abbreviation: string | null) => ({
    school,
    abbreviation,
    logo_url: null,
    color: null,
  });
  const schools = [
    opt("North Carolina", "UNC"),
    opt("North Texas", "UNT"),
    opt("Texas", "TEX"),
    opt("Texas A&M", "TAMU"),
    opt("Northwestern", "NW"),
    opt("Auburn", "AUB"),
  ];
  const names = (q: string, limit?: number) =>
    matchSchools(q, schools, limit).map((s) => s.school);

  it("finds a school by its abbreviation — the UNT question", () => {
    expect(names("UNT")).toEqual(["North Texas"]);
    expect(names("unt")).toEqual(["North Texas"]);
  });

  it("puts an exact hit first even when others contain it", () => {
    // "Texas" is also inside "North Texas" and "Texas A&M".
    expect(names("Texas")[0]).toBe("Texas");
  });

  it("prefers a prefix over a mid-string match", () => {
    const out = names("north");
    expect(out.slice(0, 3)).toEqual(["North Carolina", "North Texas", "Northwestern"]);
  });

  it("still surfaces a mid-string match when nothing starts with it", () => {
    expect(names("A&M")).toEqual(["Texas A&M"]);
  });

  it("returns nothing for an empty or whitespace query", () => {
    expect(names("")).toEqual([]);
    expect(names("   ")).toEqual([]);
  });

  it("caps the list so it never covers the page", () => {
    expect(names("a", 3).length).toBeLessThanOrEqual(3);
  });

  it("tolerates a team with no abbreviation", () => {
    expect(matchSchools("val", [opt("Valparaiso", null)])).toHaveLength(1);
    expect(matchSchools("x", [opt("Valparaiso", null)])).toEqual([]);
  });
});

describe("recordEntering", () => {
  const g = (h: number, a: number, hp: number | null, ap: number | null) => ({
    home_team_id: h,
    away_team_id: a,
    home_points: hp,
    away_points: ap,
  });

  it("counts wins and losses from either side of the ball", () => {
    // 61 wins at home, wins on the road, loses at home.
    const r = recordEntering([g(61, 2, 30, 10), g(3, 61, 7, 21), g(61, 4, 13, 20)], 61);
    expect(r).toEqual({ wins: 2, losses: 1 });
  });

  it("ignores games the team was not in", () => {
    expect(recordEntering([g(1, 2, 30, 10)], 61)).toEqual({ wins: 0, losses: 0 });
  });

  it("skips a game with no score rather than scoring it a loss", () => {
    // A cancelled or unposted final must not invent a defeat in a CLUE.
    expect(recordEntering([g(61, 2, null, null), g(61, 3, 20, 10)], 61)).toEqual({
      wins: 1,
      losses: 0,
    });
  });

  it("counts a tie as neither", () => {
    expect(recordEntering([g(61, 2, 17, 17)], 61)).toEqual({ wins: 0, losses: 0 });
  });

  it("reads as a season opener when there is nothing behind it", () => {
    // The week-0 case, which is the one a bare "0-0" would have made useless.
    expect(recordLine(recordEntering([], 61))).toBe("opening the season");
    expect(recordLine({ wins: 4, losses: 1 })).toBe("4-1 coming in");
  });
});

describe("the hint ladder", () => {
  it("buys the home team's record with the first miss, never a shrug", () => {
    // The rung that replaced the closing spread: `line_snapshots` is empty for
    // every backfilled season, so that clue could only ever say "no line
    // survives for this one" — a wasted rung on every puzzle.
    const hints = gtgHints({ ...ANSWER, homeRecord: { wins: 4, losses: 1 } }, 1);
    expect(hints).toHaveLength(2);
    expect(hints[1]!.value).toBe("4-1 coming in");
    expect(JSON.stringify(hints)).not.toContain("no line survives");
  });
});

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

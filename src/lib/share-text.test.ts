import { describe, expect, it } from "vitest";
import { EMPTY_TALLY, type Tally } from "./records";
import { formatPick, shareText, type SharePick, type ShareContext } from "./share-text";

const spread = (over: Partial<SharePick> = {}): SharePick => ({
  key: "1:spread",
  market: "spread",
  side: "home",
  line: -6.5,
  homeAbbr: "UGA",
  awayAbbr: "BAMA",
  ...over,
});

const tally = (over: Partial<Tally> = {}): Tally => ({ ...EMPTY_TALLY, ...over });

const ctx = (over: Partial<ShareContext> = {}): ShareContext => ({
  groupName: "Saturday Boys",
  userName: "Chase",
  week: 2,
  day: "Sat Sep 12",
  today: [],
  justPlaced: [],
  dayRecord: EMPTY_TALLY,
  weekRecord: EMPTY_TALLY,
  lifetimeRecord: EMPTY_TALLY,
  ...over,
});

describe("formatPick", () => {
  it("names the team, the number and the opponent for a spread", () => {
    expect(formatPick(spread())).toBe("UGA -6.5 vs BAMA");
    expect(formatPick(spread({ side: "away" }))).toBe("BAMA +6.5 vs UGA");
  });

  it("reads a straight-up pick as a winner, with no number", () => {
    expect(formatPick(spread({ market: "straight_up", line: null }))).toBe("UGA to win vs BAMA");
  });

  it("puts the matchup after a total, since neither team is the pick", () => {
    expect(formatPick(spread({ market: "total", side: "over", line: 51.5 }))).toBe(
      "Over 51.5 — BAMA/UGA",
    );
  });
});

describe("shareText", () => {
  it("has no markdown anywhere — this lands in iMessage", () => {
    const modes = ["just-placed", "today", "day-record", "lifetime"] as const;
    for (const m of modes) {
      const text = shareText(
        m,
        ctx({ today: [spread()], justPlaced: [spread()], lifetimeRecord: tally({ wins: 3, decided: 3 }) }),
      );
      // A leading #, * or - reads as a typo, and asterisks stay literal.
      expect(text).not.toMatch(/[*_`]/);
      expect(text.split("\n").every((l) => !/^\s*[#>-]/.test(l))).toBe(true);
    }
  });

  it("lists just the picks from this session by default", () => {
    const a = spread({ key: "1:spread" });
    const b = spread({ key: "2:spread", homeAbbr: "TTU", awayAbbr: "TCU", line: 3 });
    const text = shareText("just-placed", ctx({ today: [a, b], justPlaced: [b] }));
    expect(text).toContain("TTU +3 vs TCU");
    expect(text).not.toContain("UGA");
    expect(text).toContain("1 pick · Sat Sep 12");
  });

  it("lists everything from today in the today mode", () => {
    const text = shareText(
      "today",
      ctx({ today: [spread(), spread({ key: "2:spread", homeAbbr: "TTU", awayAbbr: "TCU" })] }),
    );
    expect(text).toContain("2 picks");
    expect(text).toContain("UGA -6.5 vs BAMA");
  });

  it("says so plainly when there is nothing to share", () => {
    expect(shareText("just-placed", ctx())).toContain("No picks placed yet.");
    expect(shareText("today", ctx())).toContain("No picks today.");
  });

  it("reports the day and the week in the day-record mode", () => {
    const text = shareText(
      "day-record",
      ctx({
        dayRecord: tally({ wins: 5, losses: 2, decided: 7 }),
        weekRecord: tally({ wins: 5, losses: 2, decided: 7 }),
      }),
    );
    expect(text).toContain("Today: 5-2");
    expect(text).toContain("Week 2: 5-2");
  });

  it("says 'no action yet' rather than 0-0", () => {
    expect(shareText("day-record", ctx())).toContain("Today: no action yet");
  });

  it("omits units and ROI when nothing was ever priced", () => {
    // A straight-up-only pool grades neither, and "+0.0u · 0% ROI" would read
    // as a result rather than as an absence.
    const text = shareText("lifetime", ctx({ lifetimeRecord: tally({ wins: 9, losses: 4, decided: 13 }) }));
    expect(text).toContain("Lifetime: 9-4");
    expect(text).not.toContain("Units");
    expect(text).not.toContain("ROI");
  });

  it("includes units, ROI and CLV once there is something to report", () => {
    const text = shareText(
      "lifetime",
      ctx({
        lifetimeRecord: tally({
          wins: 63,
          losses: 51,
          pushes: 3,
          decided: 117,
          units: 4.8,
          staked: 114,
          roi: 0.042,
          avgClv: 0.31,
          clvCount: 100,
        }),
      }),
    );
    expect(text).toContain("Lifetime: 63-51-3");
    expect(text).toContain("Units: +4.8");
    expect(text).toContain("ROI: 4.2%");
    expect(text).toContain("Avg CLV: +0.31");
  });

  it("names the group and the member in every mode", () => {
    for (const m of ["just-placed", "today", "day-record", "lifetime"] as const) {
      const text = shareText(m, ctx({ today: [spread()], justPlaced: [spread()] }));
      expect(text).toContain("THE CFB SLATE — Saturday Boys");
      expect(text).toContain("Chase");
    }
  });
});

describe("pre-formatted entries", () => {
  it("uses a bet's own description verbatim", () => {
    // A ledger bet is freeform text ("OSU win total o10.5"); there is no
    // honest way to rebuild a team and a number from it, so it passes through.
    const bet: SharePick = {
      key: "9",
      market: "spread",
      side: "home",
      line: null,
      homeAbbr: "",
      awayAbbr: "",
      text: "OSU win total o10.5 (2u)",
    };
    expect(formatPick(bet)).toBe("OSU win total o10.5 (2u)");
    expect(shareText("today", ctx({ today: [bet] }))).toContain("OSU win total o10.5 (2u)");
  });
});

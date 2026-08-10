import { describe, expect, it } from "vitest";
import { EMPTY_TALLY, type Tally } from "./records";
import {
  betSlipText,
  formatPick,
  shareText,
  type SharePick,
  type ShareContext,
} from "./share-text";

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

describe("kickoff grouping", () => {
  const at = (over: Partial<SharePick>): SharePick => spread({ ...over });

  it("groups picks under their kickoff, earliest first", () => {
    const text = shareText(
      "today",
      ctx({
        today: [
          at({ key: "2", kickTs: "2026-09-12T23:30:00Z", kickLabel: "SAT 6:30 PM CT", homeAbbr: "LSU", awayAbbr: "OLE" }),
          at({ key: "1", kickTs: "2026-09-12T16:00:00Z", kickLabel: "SAT 11:00 AM CT" }),
          at({ key: "3", kickTs: "2026-09-12T16:00:00Z", kickLabel: "SAT 11:00 AM CT", homeAbbr: "OSU", awayAbbr: "MICH" }),
        ],
      }),
    );
    const lines = text.split("\n");
    expect(lines.indexOf("SAT 11:00 AM CT")).toBeLessThan(lines.indexOf("SAT 6:30 PM CT"));
    // both 11am games sit under the one heading, not two
    expect(lines.filter((l) => l === "SAT 11:00 AM CT")).toHaveLength(1);
    expect(text).toContain("3 picks");
  });

  it("sinks games with no kickoff to the bottom instead of dropping them", () => {
    const text = shareText(
      "today",
      ctx({
        today: [
          at({ key: "1", kickTs: null, kickLabel: null, homeAbbr: "ARMY", awayAbbr: "NAVY" }),
          at({ key: "2", kickTs: "2026-09-12T16:00:00Z", kickLabel: "SAT 11:00 AM CT" }),
        ],
      }),
    );
    const lines = text.split("\n");
    expect(lines.indexOf("SAT 11:00 AM CT")).toBeLessThan(lines.indexOf("KICKOFF TBD"));
    expect(text).toContain("ARMY");
  });

  it("stays a flat list when nothing carries a kickoff", () => {
    // The ledger's bets have no game to take a time from; they must not all
    // end up under a "KICKOFF TBD" heading that says nothing.
    const text = shareText("today", ctx({ today: [spread(), spread({ key: "2" })] }));
    expect(text).not.toContain("KICKOFF");
  });
});

describe("betSlipText", () => {
  const bet = (over: Partial<SharePick> = {}): SharePick => ({
    key: "1:spread",
    market: "spread",
    side: "home",
    line: null,
    homeAbbr: "",
    awayAbbr: "",
    text: "UGA -6.5 -110 (2u) — BAMA @ UGA",
    kickTs: "2026-09-12T16:00:00Z",
    kickLabel: "SAT 11:00 AM CT",
    ...over,
  });

  it("heads the slip, groups by kickoff and totals the stake", () => {
    const text = betSlipText([bet(), bet({ key: "2:total", kickTs: "2026-09-13T00:00:00Z", kickLabel: "SAT 7:00 PM CT", text: "O 54.5 -110 — OSU @ MICH" })], {
      day: "Sat Sep 12",
      week: 3,
      totalUnits: 3,
    });
    expect(text).toContain("THE CFB SLATE — BET SLIP");
    expect(text).toContain("Week 3 · Sat Sep 12");
    expect(text).toContain("SAT 11:00 AM CT");
    expect(text).toContain("SAT 7:00 PM CT");
    expect(text).toContain("2 bets · 3u");
  });

  it("is plain text — this lands in iMessage too", () => {
    const text = betSlipText([bet()], { day: "Sat Sep 12", week: 3, totalUnits: 1.5 });
    expect(text).not.toMatch(/[*_`]/);
    expect(text.split("\n").every((l) => !/^\s*[#>-]/.test(l))).toBe(true);
    expect(text).toContain("1 bet · 1.5u");
  });

  it("says so when the slip is empty rather than rendering a header alone", () => {
    expect(betSlipText([], { day: "Sat Sep 12", week: 3, totalUnits: 0 })).toContain(
      "Nothing on the slip.",
    );
  });
});

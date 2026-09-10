import { describe, expect, it } from "vitest";
import { betsInLeague, byUnits, byUnitsIn, memberCut, type SheetMember } from "./betting-groups";
import { nflSeasonId } from "./league";
import { EMPTY_TALLY, type Tally } from "./records";

/**
 * GRP-13. The home's league tab cuts the season section; the member page cuts
 * everything. Both rest on three small pure functions, and these pin the one
 * property that matters: a cut is a filter on the classified rows, never a
 * re-classification, so a member's league numbers add up to their season.
 */

const t = (wins: number, losses: number, units: number, roi: number | null = null): Tally => ({
  ...EMPTY_TALLY,
  wins,
  losses,
  decided: wins + losses,
  units,
  roi,
});

const stats = (overall: Tally) => ({
  userId: "x",
  overall,
  originated: overall,
  tailing: EMPTY_TALLY,
  fading: EMPTY_TALLY,
  tailedByOthers: EMPTY_TALLY,
  fadedByOthers: EMPTY_TALLY,
  timesFollowed: 0,
});
const form = (label: "hot" | "cold" | "level") => ({ results: [], wins: 0, losses: 0, units: 0, label });

const member = (name: string, whole: Tally, cfb: Tally, nfl: Tally): SheetMember => ({
  userId: `u-${name}`,
  name,
  role: "member",
  joinedAt: "2026-08-01T00:00:00Z",
  managed: false,
  stats: stats(whole),
  form: form("level"),
  leagueSplit: { cfb, nfl },
  byLeague: {
    cfb: { stats: stats(cfb), form: form("cold") },
    nfl: { stats: stats(nfl), form: form("hot") },
  },
});

describe("betsInLeague", () => {
  const rows = [
    { id: 1, seasonId: 2026 },
    { id: 2, seasonId: nflSeasonId(2026) },
    { id: 3, seasonId: 2026 },
  ];

  it("keeps one league by the season id the bet carries", () => {
    expect(betsInLeague(rows, "cfb").map((r) => r.id)).toEqual([1, 3]);
    expect(betsInLeague(rows, "nfl").map((r) => r.id)).toEqual([2]);
  });

  it("null is the whole book, untouched", () => {
    expect(betsInLeague(rows, null)).toBe(rows);
  });
});

describe("memberCut", () => {
  const m = member("Jeff", t(8, 9, -1), t(5, 8, -3.5), t(3, 1, 2.5));

  it("null is the season", () => {
    expect(memberCut(m, null).stats.overall).toEqual(t(8, 9, -1));
    expect(memberCut(m, null).form.label).toBe("level");
  });

  it("a league is that league's numbers and that league's form", () => {
    expect(memberCut(m, "nfl").stats.overall).toEqual(t(3, 1, 2.5));
    expect(memberCut(m, "nfl").form.label).toBe("hot");
    expect(memberCut(m, "cfb").form.label).toBe("cold");
  });
});

describe("byUnitsIn", () => {
  // Jeff leads the season on CFB volume; Mo is the better NFL bettor. The
  // tab has to be able to say so.
  const jeff = member("Jeff", t(20, 10, 9), t(18, 6, 10), t(2, 4, 0.5));
  const mo = member("Mo", t(10, 8, 3), t(4, 6, -2), t(6, 2, 5));
  const nobody = member("Nobody", EMPTY_TALLY, EMPTY_TALLY, EMPTY_TALLY);

  it("ranks the whole book by season units", () => {
    expect([mo, jeff, nobody].sort(byUnits).map((m) => m.name)).toEqual(["Jeff", "Mo", "Nobody"]);
  });

  it("ranks a league tab by that league's units alone", () => {
    expect([jeff, mo, nobody].sort(byUnitsIn("nfl")).map((m) => m.name)).toEqual([
      "Mo",
      "Jeff",
      "Nobody",
    ]);
    expect([mo, jeff].sort(byUnitsIn("cfb")).map((m) => m.name)).toEqual(["Jeff", "Mo"]);
  });

  it("breaks a units tie on ROI, then name, and sinks the ungraded", () => {
    const a = member("Ann", t(5, 5, 1, 0.1), t(5, 5, 1, 0.1), EMPTY_TALLY);
    const b = member("Bob", t(5, 5, 1, 0.2), t(5, 5, 1, 0.2), EMPTY_TALLY);
    const c = member("Cal", t(5, 5, 1, 0.2), t(5, 5, 1, 0.2), EMPTY_TALLY);
    expect([nobody, a, c, b].sort(byUnitsIn("cfb")).map((m) => m.name)).toEqual([
      "Bob",
      "Cal",
      "Ann",
      "Nobody",
    ]);
  });
});

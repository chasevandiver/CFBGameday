import { describe, expect, it } from "vitest";
import { foldRecords, formatRecord, winPct, type FinalForStandings } from "./standings";

const game = (over: Partial<FinalForStandings>): FinalForStandings => ({
  home_team_id: 1,
  away_team_id: 2,
  home_points: 20,
  away_points: 10,
  conference_game: false,
  season_type: "regular",
  ...over,
});

describe("foldRecords", () => {
  it("credits winner and loser, conference flag included", () => {
    const rec = foldRecords([game({ conference_game: true })], "cfb");
    expect(rec.get(1)).toMatchObject({ w: 1, l: 0, confW: 1, confL: 0 });
    expect(rec.get(2)).toMatchObject({ w: 0, l: 1, confW: 0, confL: 1 });
  });

  it("skips finals with null points", () => {
    const rec = foldRecords([game({ home_points: null })], "cfb");
    expect(rec.size).toBe(0);
  });

  it("never counts a preseason final, either sport", () => {
    for (const sport of ["cfb", "nfl"] as const) {
      const rec = foldRecords([game({ season_type: "preseason" })], sport);
      expect(rec.size).toBe(0);
    }
  });

  it("counts an NFL tie for both sides; skips a CFB tie as data noise", () => {
    const tied = game({ home_points: 17, away_points: 17, conference_game: true });
    const nfl = foldRecords([tied], "nfl");
    expect(nfl.get(1)).toMatchObject({ w: 0, l: 0, t: 1, confT: 1 });
    expect(nfl.get(2)).toMatchObject({ w: 0, l: 0, t: 1, confT: 1 });
    expect(foldRecords([tied], "cfb").size).toBe(0);
  });

  it("postseason counts toward the record", () => {
    const rec = foldRecords([game({ season_type: "postseason" })], "nfl");
    expect(rec.get(1)?.w).toBe(1);
  });
});

describe("winPct", () => {
  it("zero games is 0, not NaN", () => {
    expect(winPct(0, 0)).toBe(0);
  });
  it("a tie counts half — the 10-6-1 vs 10-7 ordering", () => {
    // 10-6-1 = 10.5/17 ≈ .618 beats 10-7 ≈ .588
    expect(winPct(10, 6, 1)).toBeGreaterThan(winPct(10, 7));
  });
});

describe("formatRecord", () => {
  it("hides the tie tail at zero, shows it otherwise", () => {
    expect(formatRecord(10, 6)).toBe("10-6");
    expect(formatRecord(10, 6, 1)).toBe("10-6-1");
  });
});

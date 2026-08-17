import { describe, expect, it } from "vitest";
import { moneySplits } from "./splits";

describe("moneySplits", () => {
  it("splits tickets and units by side, per market", () => {
    const out = moneySplits([
      { bet_type: "spread", side: "home", units: 2 },
      { bet_type: "spread", side: "home", units: 1 },
      { bet_type: "spread", side: "away", units: "0.5" },
      { bet_type: "total", side: "over", units: 1 },
      { bet_type: "total", side: "under", units: 3 },
    ]);
    expect(out).toEqual([
      { betType: "spread", a: { n: 2, units: 3 }, b: { n: 1, units: 0.5 } },
      { betType: "total", a: { n: 1, units: 1 }, b: { n: 1, units: 3 } },
    ]);
  });

  it("a market with one bet is not a split", () => {
    expect(moneySplits([{ bet_type: "spread", side: "home", units: 1 }])).toEqual([]);
  });

  it("ignores types whose sides aren't comparable, and null sides", () => {
    const out = moneySplits([
      { bet_type: "future", side: null, units: 1 },
      { bet_type: "team_total", side: "over", units: 1 },
      { bet_type: "team_total", side: "under", units: 1 },
      { bet_type: "first_half", side: "home", units: 1 },
    ]);
    expect(out).toEqual([]);
  });
});

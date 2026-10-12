import { describe, expect, it } from "vitest";
import { autoDescription, joinSigned, lineSource, prefillFor, splitSigned, NO_PREFILL } from "./bet-form-prefill";

const lines = { spread: -6.5, total: 52.5, mlHome: -260, mlAway: 210, status: "final" };

describe("prefillFor", () => {
  it("the favorite gets the stored spread, the dog gets it flipped", () => {
    expect(prefillFor(lines, "spread", "home")).toMatchObject({
      lineSign: "-",
      lineMag: "6.5",
      oddsSign: "-",
      oddsMag: "110",
      source: "closing",
    });
    expect(prefillFor(lines, "spread", "away")).toMatchObject({ lineSign: "+", lineMag: "6.5" });
  });

  it("a pick'em is a zero, not a -0", () => {
    expect(prefillFor({ ...lines, spread: 0 }, "spread", "away")).toMatchObject({
      lineSign: "+",
      lineMag: "0",
    });
  });

  it("totals are side-agnostic and unsigned", () => {
    expect(prefillFor(lines, "total", "over")).toMatchObject({ lineMag: "52.5", oddsMag: "110" });
    expect(prefillFor(lines, "total", "under")).toMatchObject({ lineMag: "52.5" });
  });

  it("moneylines fill the odds and leave the line blank", () => {
    expect(prefillFor(lines, "moneyline", "home")).toMatchObject({
      lineMag: "",
      oddsSign: "-",
      oddsMag: "260",
    });
    expect(prefillFor(lines, "moneyline", "away")).toMatchObject({ oddsSign: "+", oddsMag: "210" });
  });

  it("says current for a game that has not kicked off", () => {
    expect(prefillFor({ ...lines, status: "scheduled" }, "spread", "home").source).toBe("current");
    expect(lineSource("in_progress")).toBe("closing");
  });

  it("suggests nothing without a side, a game, or a captured number", () => {
    expect(prefillFor(lines, "spread", "")).toBe(NO_PREFILL);
    expect(prefillFor(null, "spread", "home")).toBe(NO_PREFILL);
    expect(prefillFor({ ...lines, spread: null }, "spread", "home")).toBe(NO_PREFILL);
    expect(prefillFor({ ...lines, mlAway: null }, "moneyline", "away")).toBe(NO_PREFILL);
  });

  it("markets the site captures no line for get no suggestion", () => {
    expect(prefillFor(lines, "team_total", "over")).toBe(NO_PREFILL);
    expect(prefillFor(lines, "first_half", "home")).toBe(NO_PREFILL);
    expect(prefillFor(lines, "future", "")).toBe(NO_PREFILL);
  });
});

describe("the two halves of a signed number", () => {
  it("round-trip the way the action reads them", () => {
    expect(splitSigned(-6.5)).toEqual({ sign: "-", mag: "6.5" });
    expect(splitSigned(145)).toEqual({ sign: "+", mag: "145" });
    expect(joinSigned("-", "6.5")).toBe("-6.5");
    expect(Number(joinSigned("+", "6.5"))).toBe(6.5);
    expect(joinSigned("+", "  ")).toBe("");
  });
});

describe("autoDescription (LOGF-7)", () => {
  const game = { homeAbbr: "GB", awayAbbr: "CHI", homeName: "Green Bay Packers", awayName: "Chicago Bears" };
  const fill = (lineSign: "-" | "+", lineMag: string, oddsSign: "-" | "+" = "-", oddsMag = "110") => ({
    lineSign,
    lineMag,
    oddsSign,
    oddsMag,
  });

  it("a spread reads the way the slate's slip writes it", () => {
    expect(autoDescription(game, "spread", "home", fill("+", "1"))).toBe("Green Bay Packers +1 (CHI @ GB)");
    expect(autoDescription(game, "spread", "away", fill("-", "1.5"))).toBe("Chicago Bears -1.5 (CHI @ GB)");
  });

  it("a pick'em says PK, and no number yet leaves the number off", () => {
    expect(autoDescription(game, "spread", "home", fill("-", "0"))).toBe("Green Bay Packers PK (CHI @ GB)");
    expect(autoDescription(game, "spread", "home", fill("-", ""))).toBe("Green Bay Packers (CHI @ GB)");
  });

  it("totals, moneylines and first halves", () => {
    expect(autoDescription(game, "total", "under", fill("+", "44.5"))).toBe("Under 44.5 (CHI @ GB)");
    expect(autoDescription(game, "moneyline", "away", fill("-", "", "+", "145"))).toBe(
      "Chicago Bears ML +145 (CHI @ GB)",
    );
    expect(autoDescription(game, "first_half", "home", fill("-", "3.5"))).toBe(
      "Green Bay Packers 1H -3.5 (CHI @ GB)",
    );
  });

  it("falls back to abbreviations without names", () => {
    expect(autoDescription({ homeAbbr: "GB", awayAbbr: "CHI" }, "spread", "home", fill("+", "1"))).toBe(
      "GB +1 (CHI @ GB)",
    );
  });

  it("says nothing until the selection says enough", () => {
    expect(autoDescription(null, "spread", "home", fill("+", "1"))).toBeNull();
    expect(autoDescription(game, "spread", "", fill("+", "1"))).toBeNull();
    // whose team total is a separate question the person answers in the text
    expect(autoDescription(game, "team_total", "over", fill("+", "24.5"))).toBeNull();
    expect(autoDescription(game, "future", "", fill("+", ""))).toBeNull();
  });
});

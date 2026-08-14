import { describe, expect, it } from "vitest";
import { cardSubtitle, cardTitle } from "./share-card-build";

describe("cardTitle", () => {
  it("is possessive", () => {
    expect(cardTitle("chasevandiver")).toBe("chasevandiver’s Bets");
  });

  it("uses a typographic apostrophe, not the typewriter one", () => {
    // The card is set at display size in Archivo and Graduate, where a straight
    // quote reads as a mark rather than as punctuation. All four committed
    // fonts carry U+2019.
    expect(cardTitle("Chase")).toContain("’");
    expect(cardTitle("Chase")).not.toContain("'");
  });

  it("still adds ’s to a name that already ends in s", () => {
    expect(cardTitle("Marcus")).toBe("Marcus’s Bets");
  });

  it("falls back without turning the fallback possessive", () => {
    expect(cardTitle("")).toBe("My Bets");
    expect(cardTitle("   ")).toBe("My Bets");
  });

  it("trims a name rather than punctuating the whitespace", () => {
    expect(cardTitle("  Chase  ")).toBe("Chase’s Bets");
  });

  // The route bounds the title at 48 characters and display names are capped at
  // 24 by updateDisplayName, so the longest real title is well inside it.
  it("stays inside the title length the route accepts", () => {
    expect(cardTitle("x".repeat(24)).length).toBeLessThanOrEqual(48);
  });
});

describe("cardSubtitle", () => {
  it("reads as week then day", () => {
    expect(cardSubtitle(0, "Fri, Aug 14")).toBe("Week 0 · Fri, Aug 14");
  });
});

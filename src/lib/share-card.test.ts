import { describe, expect, it } from "vitest";
import type { ConfidenceTier } from "./db-types";
import {
  MAX_CARD_BETS,
  capForCard,
  formatOdds,
  formatUnits,
  groupByTier,
  heroBet,
  sanitizeForCard,
  slotOf,
  sortForCard,
  tierHeadline,
  totalUnits,
  type ShareCardBet,
} from "./share-card";

// Kickoffs are written in UTC and read back in Eastern, because that is what
// kickSlot does — 2026-09-12T19:30Z is 3:30pm ET, the afternoon window.
const bet = (over: Partial<ShareCardBet> = {}): ShareCardBet => ({
  key: "1:spread",
  tier: "bet",
  pick: "Georgia −6.5",
  matchup: "Tennessee at Georgia",
  away: { abbr: "TENN", logo: "https://example.test/tenn.png", color: "#FF8200" },
  home: { abbr: "UGA", logo: "https://example.test/uga.png", color: "#BA0C2F" },
  units: 1,
  odds: -110,
  kickTs: "2026-09-12T19:30:00Z",
  ...over,
});

// `key` is annotated rather than inferred: defaulting it to `tier` would narrow
// it to ConfidenceTier and reject every real key below.
const at = (tier: ConfidenceTier, kickTs: string | null, key: string = tier): ShareCardBet =>
  bet({ tier, kickTs, key });

describe("sortForCard", () => {
  it("puts conviction above the clock", () => {
    const sorted = sortForCard([
      at("bet", "2026-09-12T16:00:00Z"),
      at("century", "2026-09-13T03:30:00Z"),
      at("day", "2026-09-12T17:00:00Z"),
    ]);
    expect(sorted.map((b) => b.tier)).toEqual(["century", "day", "bet"]);
  });

  it("orders by kickoff inside a tier", () => {
    const sorted = sortForCard([
      at("bet", "2026-09-13T02:30:00Z", "late"),
      at("bet", "2026-09-12T16:00:00Z", "early"),
      at("bet", "2026-09-12T23:00:00Z", "mid"),
    ]);
    expect(sorted.map((b) => b.key)).toEqual(["early", "mid", "late"]);
  });

  it("sinks an unscheduled bet to the bottom of its own tier, not the card", () => {
    const sorted = sortForCard([
      at("bet", "2026-09-12T16:00:00Z", "scheduled-bet"),
      at("century", null, "future"),
      at("lean", "2026-09-12T16:00:00Z", "lean"),
    ]);
    // The future keeps its tier — it leads — and only loses the tiebreak.
    expect(sorted.map((b) => b.key)).toEqual(["future", "scheduled-bet", "lean"]);
  });

  it("keeps input order for a genuine tie", () => {
    const same = "2026-09-12T16:00:00Z";
    const sorted = sortForCard([at("bet", same, "a"), at("bet", same, "b"), at("bet", same, "c")]);
    expect(sorted.map((b) => b.key)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const input = [at("bet", "2026-09-12T16:00:00Z", "x"), at("century", null, "y")];
    sortForCard(input);
    expect(input.map((b) => b.key)).toEqual(["x", "y"]);
  });
});

// The four states rendered in public/design/share-card-d.html. This is the
// rule the layout reads and nothing else, so it is tested on its own.
describe("heroBet", () => {
  it("promotes a bet that stands alone at the top tier", () => {
    const bets = [at("century", "2026-09-12T19:30:00Z", "hero"), at("day", null), at("bet", null)];
    expect(heroBet(bets)?.key).toBe("hero");
  });

  it("promotes nothing when the top tier is tied", () => {
    const bets = [at("century", null, "a"), at("century", null, "b"), at("bet", null)];
    expect(heroBet(bets)).toBeNull();
  });

  it("promotes nothing when every bet shares a tier", () => {
    expect(heroBet([at("bet", null, "a"), at("bet", null, "b"), at("bet", null, "c")])).toBeNull();
  });

  it("promotes a lone bet — it is alone at the top by definition", () => {
    expect(heroBet([at("lean", null, "only")])?.key).toBe("only");
  });

  it("promotes nothing on an empty card", () => {
    expect(heroBet([])).toBeNull();
  });

  it("reads the highest tier present, not the highest tier that exists", () => {
    // No century, no year: the day bet is the top of this card.
    const bets = [at("day", null, "top"), at("bet", null), at("lean", null)];
    expect(heroBet(bets)?.key).toBe("top");
  });
});

describe("tierHeadline", () => {
  it("interpolates the broadcast window into the slate tier", () => {
    // 19:30Z = 3:30pm ET
    expect(tierHeadline(at("slate", "2026-09-12T19:30:00Z"), 1)).toBe("Bet of the Afternoon Slate");
    // 16:00Z = noon ET
    expect(tierHeadline(at("slate", "2026-09-12T16:00:00Z"), 1)).toBe("Bet of the Noon Slate");
    // 00:00Z the next day = 8pm ET
    expect(tierHeadline(at("slate", "2026-09-13T00:00:00Z"), 1)).toBe("Bet of the Primetime Slate");
  });

  it("uses the NFL's window vocabulary for an NFL bet", () => {
    const nfl = bet({ tier: "slate", kickTs: "2026-09-12T17:00:00Z", league: "nfl" });
    expect(tierHeadline(nfl, 1)).toBe("Bet of the Early window Slate");
  });

  it("falls back to the bare slate when there is no kickoff to read", () => {
    expect(tierHeadline(at("slate", null), 1)).toBe("Bet of the Slate");
  });

  it("keeps the superlatives singular over several rows — they are titles", () => {
    expect(tierHeadline(at("century", null), 3)).toBe("Bet of the Century");
    expect(tierHeadline(at("year", null), 2)).toBe("Bet of the Year");
    expect(tierHeadline(at("day", null), 4)).toBe("Bet of the Day");
  });

  it("pluralises the two rungs that are categories rather than titles", () => {
    expect(tierHeadline(at("bet", null), 1)).toBe("Bet");
    expect(tierHeadline(at("bet", null), 2)).toBe("Bets");
    expect(tierHeadline(at("lean", null), 1)).toBe("Lean");
    expect(tierHeadline(at("lean", null), 3)).toBe("Leans");
  });
});

describe("groupByTier", () => {
  it("prints one heading per tier change, not one per row", () => {
    const groups = groupByTier(
      sortForCard([
        at("bet", "2026-09-12T23:00:00Z", "b1"),
        at("bet", "2026-09-13T02:30:00Z", "b2"),
        at("century", "2026-09-12T19:30:00Z", "c1"),
      ]),
    );
    expect(groups.map((g) => g.heading)).toEqual(["Bet of the Century", "Bets"]);
    expect(groups[1].bets.map((b) => b.key)).toEqual(["b1", "b2"]);
  });

  it("collapses a whole flat slate into a single heading", () => {
    const flat = Array.from({ length: 7 }, (_, i) =>
      at("bet", `2026-09-12T1${i}:00:00Z`, `b${i}`),
    );
    const groups = groupByTier(sortForCard(flat));
    expect(groups).toHaveLength(1);
    expect(groups[0].heading).toBe("Bets");
    expect(groups[0].bets).toHaveLength(7);
  });

  it("splits the slate tier by broadcast window — they are different sections", () => {
    const groups = groupByTier(
      sortForCard([
        at("slate", "2026-09-12T16:00:00Z", "noon"),
        at("slate", "2026-09-13T00:00:00Z", "prime"),
      ]),
    );
    expect(groups.map((g) => g.heading)).toEqual([
      "Bet of the Noon Slate",
      "Bet of the Primetime Slate",
    ]);
  });

  it("keeps one heading for two slate bets sharing a window", () => {
    const groups = groupByTier(
      sortForCard([
        at("slate", "2026-09-12T19:30:00Z", "a"),
        at("slate", "2026-09-12T20:00:00Z", "b"),
      ]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].bets).toHaveLength(2);
  });

  it("returns nothing for an empty card", () => {
    expect(groupByTier([])).toEqual([]);
  });
});

describe("capForCard", () => {
  it("keeps everything when the card fits", () => {
    const { bets, overflow } = capForCard([at("bet", null, "a"), at("bet", null, "b")]);
    expect(bets).toHaveLength(2);
    expect(overflow).toBe(0);
  });

  it("cuts after sorting, so conviction survives the cut", () => {
    // The century bet is placed last and would be dropped by a naive slice.
    const many: ShareCardBet[] = [
      ...Array.from({ length: MAX_CARD_BETS }, (_, i) => at("lean", null, `lean${i}`)),
      at("century", null, "keeper"),
    ];
    const { bets, overflow } = capForCard(many);
    expect(bets).toHaveLength(MAX_CARD_BETS);
    expect(bets[0].key).toBe("keeper");
    expect(overflow).toBe(1);
  });
});

describe("the aligned column", () => {
  it("prints every stake to one decimal so the decimal points register", () => {
    expect(formatUnits(2)).toBe("2.0u");
    expect(formatUnits(1.5)).toBe("1.5u");
    expect(formatUnits(0.5)).toBe("0.5u");
    // Same width is the whole point of the column.
    expect(formatUnits(2)).toHaveLength(formatUnits(1.5).length);
  });

  it("uses a real minus sign, not a hyphen", () => {
    expect(formatOdds(-110)).toBe("−110");
    expect(formatOdds(-110)).not.toContain("-");
    expect(formatOdds(120)).toBe("+120");
  });

  it("totals the stakes for the footer", () => {
    expect(totalUnits([bet({ units: 3 }), bet({ units: 1.5 }), bet({ units: 0.5 })])).toBe(5);
    expect(totalUnits([])).toBe(0);
  });
});

describe("sanitizeForCard", () => {
  // satori draws tofu for a missing glyph instead of falling back, and the
  // ʻokina is the one gap in the four fonts the card ships with.
  it("swaps the ʻokina for a shape the card's fonts actually carry", () => {
    expect(sanitizeForCard("Hawaiʻi")).toBe("Hawai’i");
    expect(sanitizeForCard("Hawaiʻi at Stanford")).not.toContain("ʻ");
  });

  it("leaves the glyphs the fonts do carry alone", () => {
    // All verified present in Graduate, Archivo 400/700 and Plex Mono 500.
    const covered = "Texas A&M − 110 · Miami (OH) — St. John’s ‘26 José";
    expect(sanitizeForCard(covered)).toBe(covered);
  });

  it("replaces every occurrence, not just the first", () => {
    expect(sanitizeForCard("ʻaʻa")).toBe("’a’a");
  });
});

describe("slotOf", () => {
  it("is null without a kickoff, which is how a future reaches the card", () => {
    expect(slotOf(at("bet", null))).toBeNull();
  });
});

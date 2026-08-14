import { describe, expect, it } from "vitest";
import type { ConfidenceTier } from "./db-types";
import {
  CARD_H,
  MAX_CARD_BETS,
  buildCardModel,
  cardMetrics,
  capForCard,
  formatOdds,
  formatUnits,
  groupByTier,
  heroBet,
  sanitizeForCard,
  slotOf,
  sortForCard,
  tierHeadline,
  titleFontSize,
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

describe("cardMetrics", () => {
  // The sizes the original card was designed at, against a rendered mockup of
  // a *full* card. Every other count scales up from here, so if this drifts the
  // dense card drifts with it.
  it("reproduces the original sizes at a full twelve rows", () => {
    const m = cardMetrics(12, 1, false);
    expect(m).toMatchObject({
      rowH: 86,
      crest: 52,
      pick: 36,
      matchup: 21,
      units: 33,
      sub: 20,
      panel: false,
    });
  });

  it("scales a short slip up instead of leaving it in the corner", () => {
    // The bug this exists for: two bets rendered at twelve-bet sizes.
    const two = cardMetrics(2, 1, false);
    const full = cardMetrics(12, 1, false);
    expect(two.rowH).toBeGreaterThan(full.rowH * 2);
    expect(two.pick).toBeGreaterThan(full.pick);
    expect(two.crest).toBeGreaterThan(full.crest);
  });

  it("draws panels only for a slip short enough to need them", () => {
    expect(cardMetrics(1, 1, false).panel).toBe(true);
    expect(cardMetrics(3, 1, false).panel).toBe(true);
    expect(cardMetrics(4, 1, false).panel).toBe(false);
    expect(cardMetrics(12, 1, false).panel).toBe(false);
    // A hero already carries the card, so its rows stay bare lines.
    expect(cardMetrics(2, 1, true).panel).toBe(false);
  });

  it("keeps a bare-line pick small enough that the longest one cannot wrap", () => {
    // "OSU win total o10.5" is the longest pick the product builds. A bare row
    // has a fixed height, so a wrap there overflows silently.
    const longest = "OSU win total o10.5".length;
    for (const rows of [4, 5, 6, 7, 8, 10, 12]) {
      const m = cardMetrics(rows, 1, false);
      const available = 968 - (m.crestSlot + 22) - m.numsW;
      expect(longest * 0.55 * m.pick).toBeLessThan(available);
    }
  });

  // The tightest case the cap permits is twelve bets with one promoted to the
  // hero and several tier headings. This test found a 6px overrun from
  // rounding, then a 250px one from a row floor that could not fit that case at
  // all — which is why the model now drops rows into "+N more" rather than
  // shrinking them until they technically fit.
  it("never lets the rows overflow the canvas, at any count the cap allows", () => {
    const tiers: ConfidenceTier[] = ["century", "year", "day", "slate", "bet", "lean"];
    for (let total = 1; total <= MAX_CARD_BETS; total++) {
      for (const spread of [1, 3, 6]) {
        const bets = Array.from({ length: total }, (_, i) =>
          at(tiers[i % spread], `2026-09-12T${String(10 + (i % 12)).padStart(2, "0")}:00:00Z`, `b${i}`),
        );
        const model = buildCardModel({
          title: "T",
          subtitle: "S",
          bets,
          overflow: 0,
        });
        const rows = model.groups.reduce((n, g) => n + g.bets.length, 0);
        const m = cardMetrics(rows, model.groups.length, !!model.hero);
        const used =
          145 +
          97 +
          (model.hero ? 325 : 0) +
          (rows > 0 ? 26 + model.groups.length * 46 + rows * (m.rowH + m.panelGap) : 0);
        const label = `total=${total} spread=${spread} rows=${rows} hero=${!!model.hero}`;
        expect(used, label).toBeLessThanOrEqual(CARD_H);
        // Nothing is silently lost: whatever did not fit is on the card as "+N".
        expect(rows + (model.hero ? 1 : 0) + model.overflow, label).toBe(total);
      }
    }
  });

  it("drops the watermark rather than drawing a sliver of it", () => {
    expect(cardMetrics(12, 1, false).markH).toBe(0);
    expect(cardMetrics(2, 1, false).markH).toBeGreaterThan(120);
  });
});

describe("titleFontSize", () => {
  it("leaves a normal name at full size", () => {
    expect(titleFontSize("chasevandiver’s Bets")).toBe(58);
  });

  // A wrapped title makes the header taller than the row budget assumes, and a
  // nowrap one that is too wide runs under the S stamp instead of shrinking.
  it("shrinks a long name enough to clear the brand stamp", () => {
    const longest = `${"x".repeat(24)}’s Bets`;
    const size = titleFontSize(longest);
    expect(size).toBeLessThan(58);
    expect(longest.length * 0.66 * size).toBeLessThanOrEqual(860);
  });

  it("never shrinks past readable", () => {
    expect(titleFontSize("x".repeat(200))).toBe(34);
  });

  it("handles an empty title without dividing by zero", () => {
    expect(titleFontSize("")).toBe(58);
  });
});

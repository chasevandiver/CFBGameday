import { describe, expect, it } from "vitest";
import { breakLabel, dayTabLabels, nflKickSlot, underTwo } from "./kick";

describe("underTwo", () => {
  it("true only in Q2/Q4 with the clock under 2:00", () => {
    expect(underTwo(2, "1:59")).toBe(true);
    expect(underTwo(4, "0:07")).toBe(true);
    expect(underTwo(4, "2:00")).toBe(false);
    expect(underTwo(1, "1:59")).toBe(false);
    expect(underTwo(3, "0:30")).toBe(false);
  });
  it("a missing clock or period is never a warning", () => {
    expect(underTwo(4, null)).toBe(false);
    expect(underTwo(null, "1:00")).toBe(false);
  });
  it("an expired clock is not the two-minute warning — it is the opposite", () => {
    // Q2 0:00 is halftime. This wore the tensest treatment the card owns
    // through the calmest twelve minutes of the game until 2026-08-21.
    expect(underTwo(2, "0:00")).toBe(false);
    expect(underTwo(4, "0:00")).toBe(false);
    expect(underTwo(2, "00:00")).toBe(false);
    // and one second of football left is still the warning
    expect(underTwo(2, "0:01")).toBe(true);
  });
});

describe("breakLabel — what the card says when the game is not being played", () => {
  /**
   * Owner question, 2026-08-21: "is there anything stating halftime when a
   * game goes to half?" There was not — ESPN's STATUS_HALFTIME arrives as an
   * ordinary live tick because the parser reads only `type.state`, so the card
   * said `Q2 · 0:00`.
   */
  it("names halftime", () => {
    expect(breakLabel(2, "0:00")).toBe("HALFTIME");
    expect(breakLabel(2, "00:00")).toBe("HALFTIME");
  });

  it("names the gap between quarters, which was equally silent", () => {
    expect(breakLabel(1, "0:00")).toBe("END Q1");
    expect(breakLabel(3, "0:00")).toBe("END Q3");
    expect(breakLabel(4, "0:00")).toBe("END Q4");
  });

  it("carries overtime through the same rule", () => {
    expect(breakLabel(5, "0:00")).toBe("END OT");
    expect(breakLabel(6, "0:00")).toBe("END 2OT");
  });

  it("says nothing at all while the clock is running", () => {
    // The null is what every caller renders the period and clock for.
    expect(breakLabel(2, "0:01")).toBeNull();
    expect(breakLabel(1, "15:00")).toBeNull();
    expect(breakLabel(3, "7:22")).toBeNull();
  });

  it("says nothing without a period or a clock to read", () => {
    expect(breakLabel(null, "0:00")).toBeNull();
    expect(breakLabel(2, null)).toBeNull();
    expect(breakLabel(0, "0:00")).toBeNull();
    expect(breakLabel(2, "")).toBeNull();
  });
});

describe("dayTabLabels", () => {
  const CT = "America/Chicago";
  // Noon UTC keeps every one of these on the intended calendar day in CT.
  const at = (m: number, d: number) =>
    `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T18:00:00Z`;

  it("leaves an ordinary week's chips clean", () => {
    const tabs = dayTabLabels([at(9, 10), at(9, 11), at(9, 12)], CT);
    expect(tabs.map((t) => t.label)).toEqual(["Thu", "Fri", "Sat"]);
  });

  it("dates BOTH Saturdays when a week spans two of them", () => {
    // Week 1 opens Sat Aug 22 and closes Mon Aug 31 — the case that shipped
    // as "Sat · Thu · Fri · Sat" with no way to tell them apart.
    const tabs = dayTabLabels(
      [at(8, 22), at(8, 27), at(8, 28), at(8, 29), at(8, 30), at(8, 31)],
      CT,
    );
    expect(tabs.map((t) => t.label)).toEqual([
      "Sat 8/22",
      "Thu",
      "Fri",
      "Sat 8/29",
      "Sun",
      "Mon",
    ]);
  });

  it("sorts by date, not by weekday", () => {
    const tabs = dayTabLabels([at(8, 29), at(8, 22), at(8, 27)], CT);
    expect(tabs.map((t) => t.key)).toEqual(["2026-08-22", "2026-08-27", "2026-08-29"]);
  });

  it("collapses many kickoffs on one day to a single chip", () => {
    const tabs = dayTabLabels([at(9, 12), at(9, 12), at(9, 12)], CT);
    expect(tabs).toHaveLength(1);
  });
});

describe("nflKickSlot", () => {
  // Eastern-clock windows, like kickSlot: the same games in every timezone.
  it("splits a Sunday into the broadcast windows", () => {
    expect(nflKickSlot("2026-09-13T17:00:00Z")).toBe("Early window"); // 1:00 ET
    expect(nflKickSlot("2026-09-13T20:25:00Z")).toBe("Late window"); // 4:25 ET
    expect(nflKickSlot("2026-09-14T00:20:00Z")).toBe("Primetime"); // SNF 8:20 ET
  });
  it("brands the night games by day prefix, not here", () => {
    // TNF and MNF are also just Primetime — "Thu · Primetime" reads as TNF.
    expect(nflKickSlot("2026-09-11T00:15:00Z")).toBe("Primetime"); // Thu 8:15 ET
    expect(nflKickSlot("2026-09-15T00:15:00Z")).toBe("Primetime"); // Mon 8:15 ET
  });
});

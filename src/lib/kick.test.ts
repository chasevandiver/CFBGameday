import { describe, expect, it } from "vitest";
import { dayTabLabels } from "./kick";

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

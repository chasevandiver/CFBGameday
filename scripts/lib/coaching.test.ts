import { describe, expect, it } from "vitest";
import type { CfbdCoach } from "../../src/lib/cfbd";
import {
  buildCoachTransitions,
  coachOverPerformance,
  flattenCoachSeasons,
  headCoachByTeamYear,
} from "./coaching";

const coach = (
  first: string,
  last: string,
  seasons: Array<{ school: string; year: number; games?: number; spOverall?: number | null }>,
): CfbdCoach =>
  ({
    firstName: first,
    lastName: last,
    seasons: seasons.map((s) => ({
      school: s.school,
      year: s.year,
      games: s.games ?? 12,
      wins: null,
      losses: null,
      srs: null,
      spOverall: s.spOverall ?? null,
      spOffense: null,
      spDefense: null,
      preseasonRank: null,
      postseasonRank: null,
    })),
  }) as CfbdCoach;

describe("flattenCoachSeasons", () => {
  it("centers SP+ within each season so scale drift isn't read as quality", () => {
    const rows = flattenCoachSeasons([
      coach("A", "One", [{ school: "Alpha", year: 2024, spOverall: 20 }]),
      coach("B", "Two", [{ school: "Beta", year: 2024, spOverall: 10 }]),
      // a year whose whole scale is shifted up by 100
      coach("C", "Three", [{ school: "Gamma", year: 2025, spOverall: 120 }]),
      coach("D", "Four", [{ school: "Delta", year: 2025, spOverall: 110 }]),
    ]);
    const centered = (school: string) => rows.find((r) => r.school === school)?.centered;
    // identical shape in both years despite the +100 shift
    expect(centered("Alpha")).toBeCloseTo(5, 10);
    expect(centered("Gamma")).toBeCloseTo(5, 10);
  });

  it("tolerates snake_case payloads", () => {
    const raw = [
      { first_name: "Snake", last_name: "Case", seasons: [{ school: "Alpha", year: 2024, games: 12, sp_overall: 7 }] },
    ] as unknown as CfbdCoach[];
    const rows = flattenCoachSeasons(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].coach).toBe("Snake Case");
    expect(rows[0].centered).toBeCloseTo(0, 10); // sole row → it is the mean
  });

  it("drops rows with no school or year", () => {
    const raw = [{ firstName: "X", lastName: "Y", seasons: [{ year: 2024 }, { school: "Alpha" }] }] as unknown as CfbdCoach[];
    expect(flattenCoachSeasons(raw)).toHaveLength(0);
  });
});

describe("headCoachByTeamYear", () => {
  it("attributes a mid-season firing to whoever coached more games", () => {
    const seasons = flattenCoachSeasons([
      coach("Fired", "Guy", [{ school: "Alpha", year: 2024, games: 4, spOverall: 0 }]),
      coach("Interim", "Boss", [{ school: "Alpha", year: 2024, games: 8, spOverall: 0 }]),
    ]);
    expect(headCoachByTeamYear(seasons).get("Alpha|2024")).toBe("Interim Boss");
  });
});

describe("coachOverPerformance", () => {
  // Alpha is a mediocre program (centered SP+ 0 under others); our coach ran
  // it at +6 for two years, so he beat the program's own baseline by 6.
  const coaches = [
    coach("Star", "Hire", [
      { school: "Alpha", year: 2022, spOverall: 6 },
      { school: "Alpha", year: 2023, spOverall: 6 },
    ]),
    coach("Before", "Him", [
      { school: "Alpha", year: 2020, spOverall: 0 },
      { school: "Alpha", year: 2021, spOverall: 0 },
    ]),
    // filler so the per-year centering mean stays 0
    coach("Mirror", "Team", [
      { school: "Beta", year: 2020, spOverall: 0 },
      { school: "Beta", year: 2021, spOverall: 0 },
      { school: "Beta", year: 2022, spOverall: -6 },
      { school: "Beta", year: 2023, spOverall: -6 },
    ]),
  ];
  const seasons = flattenCoachSeasons(coaches);
  const heads = headCoachByTeamYear(seasons);

  it("measures a coach against the program's baseline without him", () => {
    const over = coachOverPerformance("Star Hire", 2024, seasons, heads);
    expect(over).not.toBeNull();
    expect(over as number).toBeGreaterThan(0);
  });

  it("is point-in-time: seasons at or after the target year are invisible", () => {
    // as of 2023 only the 2022 season counts; as of 2022, nothing does
    expect(coachOverPerformance("Star Hire", 2022, seasons, heads)).toBeNull();
    expect(coachOverPerformance("Star Hire", 2023, seasons, heads)).not.toBeNull();
  });

  it("returns null for a first-time head coach", () => {
    expect(coachOverPerformance("Nobody At All", 2024, seasons, heads)).toBeNull();
  });
});

describe("buildCoachTransitions", () => {
  const coaches = [
    coach("Old", "Coach", [{ school: "Alpha", year: 2024, spOverall: 0 }]),
    coach("New", "Coach", [
      { school: "Beta", year: 2022, spOverall: 5 },
      { school: "Beta", year: 2023, spOverall: 5 },
      { school: "Alpha", year: 2025, spOverall: 0 },
    ]),
    coach("Steady", "Hand", [
      { school: "Gamma", year: 2024, spOverall: 0 },
      { school: "Gamma", year: 2025, spOverall: 0 },
    ]),
    coach("Other", "Guy", [
      { school: "Beta", year: 2024, spOverall: 0 },
      { school: "Beta", year: 2025, spOverall: 0 },
    ]),
  ];

  it("flags a school that changed head coaches", () => {
    const t = buildCoachTransitions(coaches, 2025).get("Alpha");
    expect(t?.newHc).toBe(true);
    expect(t?.coach).toBe("New Coach");
    expect(t?.previousCoach).toBe("Old Coach");
    expect(t?.overPerf).not.toBeNull(); // he has 2022–23 history at Beta
  });

  it("leaves a school with continuity alone", () => {
    const t = buildCoachTransitions(coaches, 2025).get("Gamma");
    expect(t?.newHc).toBe(false);
    expect(t?.overPerf).toBeNull();
  });

  it("reports intact (not a new hire) when the target year has no coach row", () => {
    // 2026 exists for nobody here — the upcoming-season case
    for (const t of buildCoachTransitions(coaches, 2026).values()) {
      expect(t.newHc).toBe(false);
      expect(t.coach).toBeNull();
    }
  });
});

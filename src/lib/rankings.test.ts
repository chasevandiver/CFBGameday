import { describe, expect, it } from "vitest";
import { buildTeamNameIndex, pickPollRanks, pollShortName } from "./rankings";

describe("buildTeamNameIndex", () => {
  const teams = [
    { id: 1, school: "Ohio State", alt_names: ["Ohio St."] },
    { id: 2, school: "San José State", alt_names: ["San Jose State", "SJSU"] },
    { id: 3, school: "Georgia", alt_names: null },
  ];

  it("matches school names case-insensitively", () => {
    const index = buildTeamNameIndex(teams);
    expect(index.get("ohio state")).toBe(1);
    expect(index.get("GEORGIA".toLowerCase())).toBe(3);
  });

  it("matches alt_names for CFBD spelling drift", () => {
    const index = buildTeamNameIndex(teams);
    expect(index.get("san jose state")).toBe(2);
    expect(index.get("ohio st.")).toBe(1);
  });

  it("misses stay missing (repair channel is alt_names)", () => {
    const index = buildTeamNameIndex(teams);
    expect(index.get("ohio")).toBeUndefined();
  });
});

describe("pickPollRanks", () => {
  const row = (week: number, poll: string, team_id: number, rank: number) => ({
    week,
    poll,
    team_id,
    rank,
  });

  it("uses the latest week and prefers AP before the committee publishes", () => {
    const rows = [
      row(5, "AP Top 25", 1, 3),
      row(6, "AP Top 25", 1, 2),
      row(6, "Coaches Poll", 1, 1),
    ];
    const { poll, byTeam } = pickPollRanks(rows);
    expect(poll).toBe("AP Top 25");
    expect(byTeam.get(1)).toBe(2);
  });

  it("prefers the CFP committee once it exists in the latest week", () => {
    const rows = [
      row(10, "AP Top 25", 1, 4),
      row(10, "Playoff Committee Rankings", 1, 6),
      row(10, "Playoff Committee Rankings", 2, 1),
    ];
    const { poll, byTeam } = pickPollRanks(rows);
    expect(poll).toBe("Playoff Committee Rankings");
    expect(byTeam.get(1)).toBe(6);
    expect(byTeam.get(2)).toBe(1);
  });

  it("a team ranked in an earlier week but not the latest is unranked", () => {
    const rows = [row(5, "AP Top 25", 1, 20), row(6, "AP Top 25", 2, 19)];
    const { byTeam } = pickPollRanks(rows);
    expect(byTeam.get(1)).toBeUndefined();
    expect(byTeam.get(2)).toBe(19);
  });

  it("empty input → no poll", () => {
    expect(pickPollRanks([])).toEqual({ poll: null, byTeam: new Map() });
  });
});

describe("pollShortName", () => {
  it("compact pips", () => {
    expect(pollShortName("AP Top 25")).toBe("AP");
    expect(pollShortName("Playoff Committee Rankings")).toBe("CFP");
    expect(pollShortName("Coaches Poll")).toBe("Coaches");
    expect(pollShortName(null)).toBeNull();
  });
});

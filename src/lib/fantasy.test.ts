import { describe, expect, it } from "vitest";
import { toFantasy, type EspnLeague, type EspnProSchedules } from "./fantasy";

/* TV-12: ESPN's league feed in, the TV's matchups out. Shapes trimmed from the
   real feed for league 1129229, week 10. */
const KICK_SUN = 1_794_765_600_000;
const KICK_THU = 1_794_532_500_000;
const pro: EspnProSchedules = {
  settings: {
    proTeams: [
      {
        id: 25,
        proGamesByScoringPeriod: {
          "10": [{ date: KICK_SUN, homeProTeamId: 6, awayProTeamId: 25 }],
        },
      },
      {
        id: 19,
        proGamesByScoringPeriod: {
          "10": [{ date: KICK_THU, homeProTeamId: 19, awayProTeamId: 28 }],
        },
      },
      { id: 21 }, // bye
    ],
  },
};
const entry = (slot: number, proTeamId: number) => ({
  lineupSlotId: slot,
  playerPoolEntry: { appliedStatTotal: 0, player: { proTeamId } },
});
const league: EspnLeague = {
  scoringPeriodId: 10,
  status: { currentMatchupPeriod: 10 },
  teams: [
    {
      id: 1,
      name: "Im Deleting the League",
      abbrev: "KMS",
      logo: "https://x/kms.png",
      record: { overall: { wins: 5, losses: 4, ties: 0 } },
    },
    {
      id: 3,
      location: "Alpha",
      nickname: "Furry",
      abbrev: "Bust",
      record: { overall: { wins: 7, losses: 2, ties: 0 } },
    },
    { id: 4, name: "Tuten and Bootin", abbrev: "Toot" },
    { id: 9, name: "psychedelic cowgirls", abbrev: "HAAS" },
  ],
  schedule: [
    { id: 9, matchupPeriodId: 9, winner: "HOME", home: { teamId: 1 }, away: { teamId: 4 } },
    {
      id: 46,
      matchupPeriodId: 10,
      winner: "UNDECIDED",
      home: {
        teamId: 3,
        totalPointsLive: 12.4,
        totalProjectedPointsLive: 91.7,
        winProbability: 0.32,
      },
      away: {
        teamId: 4,
        totalPointsLive: 20,
        totalProjectedPointsLive: 124.83,
        winProbability: 0.68,
      },
    },
    {
      id: 48,
      matchupPeriodId: 10,
      winner: "UNDECIDED",
      home: {
        teamId: 9,
        totalPointsLive: 3,
        winProbability: 0.4,
        rosterForCurrentScoringPeriod: { entries: [entry(0, 19)] },
      },
      away: {
        teamId: 1,
        totalPointsLive: 18.36,
        totalProjectedPointsLive: 110.04,
        winProbability: 0.6,
        rosterForCurrentScoringPeriod: {
          entries: [entry(2, 25), entry(4, 19), entry(6, 21), entry(20, 25), entry(21, 25)],
        },
      },
    },
  ],
};

describe("toFantasy", () => {
  it("puts the viewer's matchup first, with their team as side a", () => {
    const d = toFantasy(league, pro, 1, KICK_THU + 60_000);
    expect(d.week).toBe(10);
    expect(d.matchups.map((m) => m.id)).toEqual([48, 46]);
    const me = d.matchups[0];
    expect(me.mine).toBe(true);
    expect(me.a).toMatchObject({
      teamId: 1,
      name: "Im Deleting the League",
      record: "5-4",
      score: 18.36,
      projected: 110,
      winProb: 0.6,
    });
    expect(me.b.name).toBe("psychedelic cowgirls");
  });

  it("counts starters by where their NFL game is; bench, IR and byes aside", () => {
    // Thursday night, game on: the NYG starter is playing, SF yet to play,
    // the PHI starter is on bye (done); bench and IR SF players don't count.
    const live = toFantasy(league, pro, 1, KICK_THU + 60_000).matchups[0].a;
    expect([live.toPlay, live.playing, live.done]).toEqual([1, 1, 1]);
    expect(toFantasy(league, pro, 1, KICK_THU + 60_000).live).toBe(true);
    // Sunday night, everything over.
    const late = toFantasy(league, pro, 1, KICK_SUN + 5 * 3_600_000).matchups[0].a;
    expect([late.toPlay, late.playing, late.done]).toEqual([0, 0, 3]);
  });

  it("names a team from location + nickname when there is no name", () => {
    const d = toFantasy(league, pro, null, 0);
    expect(d.matchups.find((m) => m.id === 46)?.b.name).toBe("Alpha Furry");
    expect(d.matchups.every((m) => !m.mine)).toBe(true);
  });

  it("drops the win probability once a matchup is decided", () => {
    const done = { ...league, schedule: league.schedule.map((m) => ({ ...m, winner: "AWAY" })) };
    const me = toFantasy(done, pro, 1, 0).matchups[0];
    expect(me.final).toBe(true);
    expect(me.a.winProb).toBeNull();
  });
});

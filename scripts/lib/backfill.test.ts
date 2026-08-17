import { describe, expect, it } from "vitest";
import { backfillRows } from "./backfill";
import type { CfbdGame } from "../../src/lib/cfbd";

/**
 * The pure half. What matters here is the DROPPING: a game whose teams are
 * not in `teams` would fail the foreign key mid-batch and leave a season half
 * loaded, so it has to be filtered out before the upsert rather than
 * discovered by Postgres.
 */

const game = (over: Partial<CfbdGame> = {}): CfbdGame =>
  ({
    id: 1,
    season: 2024,
    week: 5,
    seasonType: "regular",
    startDate: "2024-09-28T16:00:00.000Z",
    startTimeTBD: false,
    neutralSite: false,
    conferenceGame: true,
    venueId: 100,
    homeId: 10,
    homeTeam: "Home",
    homePoints: 31,
    homePostgameWinProbability: null,
    awayId: 20,
    awayTeam: "Away",
    awayPoints: 17,
    awayPostgameWinProbability: null,
    completed: true,
    notes: null,
    ...over,
  }) as CfbdGame;

const known = new Set([10, 20, 30]);

describe("backfillRows", () => {
  it("keeps a game both of whose teams are known", () => {
    const { rows } = backfillRows([game()], 2024, known);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.season_id).toBe(2024);
    expect(rows[0]!.status).toBe("final");
  });

  it("drops a game with an unknown team rather than letting the FK find it", () => {
    const { rows, droppedUnknownTeam } = backfillRows(
      [game(), game({ id: 2, awayId: 999 }), game({ id: 3, homeId: 998 })],
      2024,
      known,
    );
    expect(rows.map((r) => r.id)).toEqual([1]);
    expect(droppedUnknownTeam).toBe(2);
  });

  it("drops a game with no kickoff", () => {
    const { rows, droppedNoKickoff } = backfillRows(
      [game({ id: 4, startDate: null as unknown as string })],
      2024,
      known,
    );
    expect(rows).toEqual([]);
    expect(droppedNoKickoff).toBe(1);
  });

  it("asserts status only on completed games", () => {
    // The same asymmetry sync-games keeps: an unfinished row takes the schema
    // default instead of being pushed back to 'scheduled'.
    const { rows } = backfillRows([game({ completed: false, homePoints: null })], 2024, known);
    expect(rows[0]!.status).toBeUndefined();
  });

  it("stamps the season it was asked for, not the one CFBD echoes", () => {
    const { rows } = backfillRows([game({ season: 1999 })], 2024, known);
    expect(rows[0]!.season_id).toBe(2024);
  });

  it("splits week 0 back out when the feed merged it into week 1", () => {
    // Two Saturdays and the quiet stretch between them, all labelled week 1 —
    // the 2026 shape. The span has to clear SPAN_DAYS (8) for the split to
    // fire at all, which is the conservatism weeks.ts is built around.
    const opener = game({ id: 90, week: 1, startDate: "2024-08-24T16:00:00.000Z" });
    const wk1 = Array.from({ length: 4 }, (_, i) =>
      game({ id: 100 + i, week: 1, startDate: `2024-09-0${2 + i}T16:00:00.000Z` }),
    );
    const { rows } = backfillRows([opener, ...wk1], 2024, known);
    expect(rows.find((r) => r.id === 90)!.week).toBe(0);
    expect(rows.filter((r) => r.id >= 100).every((r) => r.week === 1)).toBe(true);
  });
});

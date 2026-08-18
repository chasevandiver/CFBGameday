import { describe, expect, it } from "vitest";
import {
  BACKFILL_CAPTURE_LEAD_MS,
  BACKFILL_LINE_SOURCE,
  backfillRows,
  backfillSnapshotRows,
} from "./backfill";
import { consensusFromSnapshots } from "../../src/lib/consensus";
import type { CfbdGame, CfbdLine } from "../../src/lib/cfbd";

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

/* ---- BF-2: conference at kickoff --------------------------------------- */

describe("backfillRows — conference at kickoff", () => {
  it("carries the conferences CFBD sent for that season", () => {
    const { rows } = backfillRows(
      [game({ homeConference: "Big 12", awayConference: "Pac-12" })],
      2016,
      known,
    );
    expect(rows[0]!.home_conference).toBe("Big 12");
    expect(rows[0]!.away_conference).toBe("Pac-12");
  });

  /**
   * `undefined` and `null` are different statements to PostgREST: an absent key
   * means "leave the column alone", a null means "we do not know". Cached
   * season files predate the field (see CfbdGame's docstring), so undefined is
   * reachable and must land as an explicit null.
   */
  it("lands an explicit null when CFBD omits them", () => {
    const { rows } = backfillRows([game()], 2016, known);
    expect(rows[0]!.home_conference).toBeNull();
    expect(rows[0]!.away_conference).toBeNull();
    expect("home_conference" in rows[0]!).toBe(true);
  });

  /**
   * The upsert groups rows by their key set because PostgREST bulk rows must
   * share a column set. Two always-present columns must not add a third shape;
   * if they ever became conditional this fails.
   */
  it("does not add a row shape", () => {
    const { rows } = backfillRows(
      [
        game({ id: 1, completed: true }),
        game({ id: 2, completed: false, homeConference: "MAC" }),
        game({ id: 3, completed: true, awayConference: "SEC" }),
      ],
      2016,
      known,
    );
    const shapes = new Set(rows.map((r) => Object.keys(r).sort().join(",")));
    expect(shapes.size).toBe(2); // status present / absent, and nothing else
  });
});

/* ---- BF-3: reconstructed line snapshots -------------------------------- */

const KICKOFF = "2016-10-08T16:00:00.000Z";

const line = (over: Partial<CfbdLine["lines"][number]> = {}): CfbdLine["lines"][number] => ({
  provider: "consensus",
  spread: -6.5,
  formattedSpread: null,
  spreadOpen: -7,
  overUnder: 54.5,
  overUnderOpen: 55,
  homeMoneyline: -260,
  awayMoneyline: 210,
  ...over,
});

const cfbdLine = (over: Partial<CfbdLine> = {}): CfbdLine => ({
  id: 1,
  homeTeam: "Home",
  awayTeam: "Away",
  lines: [line()],
  ...over,
});

const starts = (ts: string | null = KICKOFF) => new Map([[1, ts]]);

describe("backfillSnapshotRows", () => {
  it("captures exactly one hour before kickoff", () => {
    const { rows } = backfillSnapshotRows([cfbdLine()], starts());
    expect(rows).toHaveLength(1);
    expect(Date.parse(rows[0]!.captured_at)).toBe(Date.parse(KICKOFF) - BACKFILL_CAPTURE_LEAD_MS);
  });

  /**
   * THE regression this whole constant exists for. The closing line is "the
   * last snapshot with captured_at < start_ts"; the column default is now(),
   * which for a 2016 game is years after kickoff. A reconstruction stamped
   * that way is invisible to every closing-line reader, and it presents as a
   * CFBD coverage problem rather than as a bug here. Two pure functions, no
   * database — so there is no excuse for not pinning it.
   */
  it("produces a snapshot the closing-line reader can actually see", () => {
    const { rows } = backfillSnapshotRows([cfbdLine()], starts());
    const closing = consensusFromSnapshots(rows, KICKOFF);
    expect(closing.spread).toBe(-6.5);
    expect(closing.total).toBe(54.5);
  });

  /**
   * Signs pass through untouched: CFBD's spread is already home-perspective
   * with negative meaning the home team is favoured, which is the convention
   * every reader assumes (see bet-line-convention.test.ts). The correct amount
   * of arithmetic is none, and this asserts it rather than trusting it.
   */
  it("keeps the home-perspective sign convention in both directions", () => {
    const homeFav = backfillSnapshotRows([cfbdLine({ lines: [line({ spread: -13.5 })] })], starts());
    expect(homeFav.rows[0]!.spread).toBe(-13.5);
    const awayFav = backfillSnapshotRows([cfbdLine({ lines: [line({ spread: 3 })] })], starts());
    expect(awayFav.rows[0]!.spread).toBe(3);
  });

  it("carries the opening numbers so the archive keeps the price story", () => {
    const { rows } = backfillSnapshotRows([cfbdLine()], starts());
    expect(rows[0]!.spread_open).toBe(-7);
    expect(rows[0]!.total_open).toBe(55);
  });

  /** Its own source, so a reconstruction is never mistaken for an observation
   *  and a re-run can delete only its own rows. */
  it("marks the rows as reconstructions", () => {
    const { rows } = backfillSnapshotRows([cfbdLine()], starts());
    expect(rows[0]!.source).toBe(BACKFILL_LINE_SOURCE);
    expect(rows[0]!.source).not.toBe("cfbd");
  });

  /** No kickoff, no defensible capture time. Drop and count. */
  it("drops a game with no kickoff rather than guessing one", () => {
    const { rows, droppedNoKickoff } = backfillSnapshotRows([cfbdLine()], starts(null));
    expect(rows).toHaveLength(0);
    expect(droppedNoKickoff).toBe(1);
  });

  /** A line for a game the games backfill dropped has nothing to anchor to. */
  it("drops a line for a game we never landed", () => {
    const { rows, droppedNoKickoff } = backfillSnapshotRows([cfbdLine({ id: 999 })], starts());
    expect(rows).toHaveLength(0);
    expect(droppedNoKickoff).toBe(1);
  });

  /** A provider row with neither number in it is not a market. */
  it("drops an entry carrying no spread and no total", () => {
    const { rows, droppedNoMarket } = backfillSnapshotRows(
      [cfbdLine({ lines: [line({ spread: null, overUnder: null })] })],
      starts(),
    );
    expect(rows).toHaveLength(0);
    expect(droppedNoMarket).toBe(1);
  });

  it("keeps a total-only entry", () => {
    const { rows } = backfillSnapshotRows(
      [cfbdLine({ lines: [line({ spread: null })] })],
      starts(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spread).toBeNull();
    expect(rows[0]!.total).toBe(54.5);
  });

  /**
   * One row per provider, so the multi-provider consensus mean still works on
   * the archive exactly as it does on the live season.
   */
  it("writes one row per provider", () => {
    const { rows } = backfillSnapshotRows(
      [
        cfbdLine({
          lines: [
            line({ provider: "Bovada", spread: -6.5 }),
            line({ provider: "DraftKings", spread: -7 }),
          ],
        }),
      ],
      starts(),
    );
    expect(rows.map((r) => r.provider)).toEqual(["Bovada", "DraftKings"]);
    expect(consensusFromSnapshots(rows, KICKOFF).spread).toBe(-7); // mean −6.75, snapped
  });

  /**
   * A real observation must beat a reconstruction. `refresh-lines --burst`
   * captures inside 90 minutes of kickoff, so an hour's lead is what keeps the
   * real row later and therefore the closing one.
   */
  it("loses the closing slot to a real snapshot captured nearer kickoff", () => {
    const { rows } = backfillSnapshotRows([cfbdLine({ lines: [line({ spread: -6.5 })] })], starts());
    const real = {
      game_id: 1,
      provider: "consensus",
      spread: -9.5,
      spread_open: null,
      total: null,
      captured_at: new Date(Date.parse(KICKOFF) - 10 * 60 * 1000).toISOString(),
    };
    expect(consensusFromSnapshots([...rows, real], KICKOFF).spread).toBe(-9.5);
  });
});

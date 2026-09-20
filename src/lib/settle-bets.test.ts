import { describe, expect, it } from "vitest";
import { asClient, FakeSupabase } from "../../scripts/lib/fake-supabase";
import { settleBetsOnFinalGame } from "./settle-bets";

/**
 * SETTLE-1: a bet logged on a game that is already over settles on the spot.
 *
 * The season pass (`scripts/lib/grade-at-final.test.ts`) covers the other
 * direction — a game finishing under bets that were already there. What is
 * asserted here is the bet-driven entry point: the same numbers, reached from
 * the row rather than from the game, and cheap and idempotent enough to sit in
 * the write path of every bet anybody logs.
 */

const KICKOFF = "2026-09-20T03:00:00Z";

/** UCLA 52, Purdue 38 — the owner report this was found in. Margin 14. */
const seed = (bets: Record<string, unknown>[]) => ({
  games: [
    {
      id: 401858458,
      season_id: 2026,
      status: "final",
      home_points: 52,
      away_points: 38,
      start_ts: KICKOFF,
    },
  ],
  line_snapshots: [
    {
      id: 1,
      game_id: 401858458,
      provider: "DraftKings",
      spread: -14,
      spread_open: -13,
      total: 59.5,
      captured_at: "2026-09-20T02:30:00Z",
    },
  ],
  bets,
});

const spreadBet = (over: Record<string, unknown> = {}) => ({
  id: 277,
  game_id: 401858458,
  bet_type: "spread",
  side: "home",
  team_side: null,
  line_taken: -13.5,
  odds: -110,
  units: 1,
  result: null,
  voided_at: null,
  clv: null,
  closing_line: null,
  payout_units: null,
  ...over,
});

describe("settleBetsOnFinalGame", () => {
  it("settles a bet logged after the final, at the price it was taken at", async () => {
    const db = new FakeSupabase(seed([spreadBet()]));
    expect(await settleBetsOnFinalGame(asClient(db), 401858458)).toBe(1);

    const row = db.rows("bets")[0];
    // −13.5 against a 14-point win is a WIN. The −14 the ledger carried before
    // the re-log is the push that started this.
    expect(row.result).toBe("win");
    expect(row.payout_units).toBe(0.91);
    expect(row.closing_line).toBe(-14);
    // Took −13.5, closed −14: half a point the right way.
    expect(row.clv).toBe(0.5);
  });

  it("still pushes the number that pushes", async () => {
    const db = new FakeSupabase(seed([spreadBet({ line_taken: -14 })]));
    await settleBetsOnFinalGame(asClient(db), 401858458);
    expect(db.rows("bets")[0].result).toBe("push");
    expect(db.rows("bets")[0].payout_units).toBe(0);
  });

  it("is idempotent — a second call writes nothing, and reads almost nothing", async () => {
    const db = new FakeSupabase(seed([spreadBet()]));
    await settleBetsOnFinalGame(asClient(db), 401858458);
    const snapsBefore = db.readCount("line_snapshots");

    expect(await settleBetsOnFinalGame(asClient(db), 401858458)).toBe(0);
    expect(db.rows("bets")[0].result).toBe("win");
    // The ungraded read decides whether the priced read happens at all, so a
    // re-log on a game with nothing open never touches the snapshots.
    expect(db.readCount("line_snapshots")).toBe(snapsBefore);
  });

  it("does nothing to a game that is not final, and never reads its bets", async () => {
    const db = new FakeSupabase({
      ...seed([spreadBet()]),
      games: [
        {
          id: 401858458,
          season_id: 2026,
          status: "in_progress",
          home_points: 24,
          away_points: 21,
          start_ts: KICKOFF,
        },
      ],
    });
    expect(await settleBetsOnFinalGame(asClient(db), 401858458)).toBe(0);
    expect(db.rows("bets")[0].result).toBeNull();
    expect(db.readCount("bets")).toBe(0);
  });

  it("leaves a graded row and a voided row alone", async () => {
    const db = new FakeSupabase(
      seed([
        spreadBet({ id: 1, result: "push", payout_units: 0 }),
        spreadBet({ id: 2, voided_at: "2026-09-20T12:00:00Z" }),
      ]),
    );
    expect(await settleBetsOnFinalGame(asClient(db), 401858458)).toBe(0);
    expect(db.rows("bets")[0].result).toBe("push");
    expect(db.rows("bets")[1].result).toBeNull();
  });

  it("settles a first half only when the plays prove the half, by the key that exists", async () => {
    const db = new FakeSupabase({
      ...seed([spreadBet({ bet_type: "first_half", line_taken: -7 })]),
      // GRADE-3: `scoring_plays` has no `id`, so the order is (game_id, sequence).
      scoring_plays: [
        { game_id: 401858458, sequence: 1, period: 1, clock: "5:00", scoring_team_id: 1, play_type: "TD", play_text: "", home_points: 7, away_points: 0, source: "espn" },
        { game_id: 401858458, sequence: 2, period: 2, clock: "1:00", scoring_team_id: 1, play_type: "TD", play_text: "", home_points: 14, away_points: 0, source: "espn" },
        { game_id: 401858458, sequence: 3, period: 3, clock: "9:00", scoring_team_id: 2, play_type: "TD", play_text: "", home_points: 14, away_points: 7, source: "espn" },
      ],
    });
    db.columns.set(
      "scoring_plays",
      ["game_id", "sequence", "period", "clock", "scoring_team_id", "play_type", "play_text", "home_points", "away_points", "source"],
    );
    // The plays do not add up to 52-38, so the half is not provable and the
    // row waits for a manual result rather than being guessed at.
    expect(await settleBetsOnFinalGame(asClient(db), 401858458)).toBe(0);
    expect(db.rows("bets")[0].result).toBeNull();
  });

  it("does not read the plays at all unless a first-half bet is open", async () => {
    const db = new FakeSupabase(seed([spreadBet()]));
    await settleBetsOnFinalGame(asClient(db), 401858458);
    expect(db.readCount("scoring_plays")).toBe(0);
  });
});

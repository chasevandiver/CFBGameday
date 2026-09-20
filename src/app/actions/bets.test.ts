import { describe, expect, it, vi, beforeEach } from "vitest";
import { FakeSupabase } from "../../../scripts/lib/fake-supabase";

/**
 * 0083: logging a bet as a member of your betting group.
 *
 * The grant is the database's (`can_log_bet_for`, asserted in
 * supabase/tests/log-bets-for.sql). What is asserted here is the shape of
 * the row the actions write when the grant says yes — the member's id as the
 * bettor, the admin's as the byline — and that a "no" stops the write before
 * it reaches the table, with a sentence rather than an RLS error.
 *
 * Mocked at the module boundary, the admin-wagers pattern: the action calls
 * `createClient()` (cookies), which has no meaning in a test process.
 */

const admin = "aaaaaaaa-0000-0000-0000-000000000001";
const member = "bbbbbbbb-0000-0000-0000-000000000002";

let db: FakeSupabase;
let grant: boolean;
let rpcCalls: Array<{ fn: string; args: unknown }>;

vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: admin } } }) },
    from: (t: string) => db.from(t),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return fn === "can_log_bet_for" ? { data: grant, error: null } : { data: null, error: null };
    },
  }),
}));

/* SETTLE-1: the inline settle runs on the service client, for the same reason
   the admin void does — `result` and `payout_units` are the grader's columns.
   Pointed at the same fake, so what it writes is visible on the same rows. */
vi.mock("../../lib/supabase/service", () => ({
  createServiceClient: () => ({ from: (t: string) => db.from(t) }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

beforeEach(() => {
  db = new FakeSupabase({
    games: [{ id: 401, season_id: 2026 }],
    bets: [
      { id: 900, user_id: member, description: "Georgia -3", result: null, voided_at: null },
      { id: 901, user_id: admin, description: "Bama -7", result: null, voided_at: null },
    ],
  });
  grant = true;
  rpcCalls = [];
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("logBet for a member", () => {
  it("writes the member as the bettor and the admin as the byline", async () => {
    const { logBet } = await import("./bets");
    const res = await logBet(
      form({ description: "UGA -3.5", units: "1", season_id: "2026", game_id: "401", for_user: member }),
    );
    expect(res.ok).toBe(true);
    const row = db.rows("bets").at(-1)!;
    expect(row.user_id).toBe(member);
    expect(row.logged_by).toBe(admin);
    expect(rpcCalls).toEqual([{ fn: "can_log_bet_for", args: { p_user: member } }]);
  });

  it("your own row carries no byline and asks nobody", async () => {
    const { logBet } = await import("./bets");
    const res = await logBet(form({ description: "UGA -3.5", units: "1", season_id: "2026" }));
    expect(res.ok).toBe(true);
    const row = db.rows("bets").at(-1)!;
    expect(row.user_id).toBe(admin);
    expect(row.logged_by).toBeNull();
    expect(rpcCalls).toHaveLength(0);
  });

  it("naming yourself is the same as naming nobody", async () => {
    const { logBet } = await import("./bets");
    await logBet(form({ description: "UGA -3.5", units: "1", season_id: "2026", for_user: admin }));
    expect(db.rows("bets").at(-1)!.logged_by).toBeNull();
    expect(rpcCalls).toHaveLength(0);
  });

  it("stops before the table when the database says no", async () => {
    grant = false;
    const { logBet } = await import("./bets");
    const res = await logBet(
      form({ description: "UGA -3.5", units: "1", season_id: "2026", for_user: member }),
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/betting group you run/);
    expect(db.rows("bets")).toHaveLength(2);
  });
});

describe("logSlipBets for a member", () => {
  const slip = [
    {
      gameId: 401,
      betType: "spread",
      side: "home",
      line: -3.5,
      odds: -110,
      units: 1,
      description: "UGA -3.5",
      confidence: "bet",
    },
    {
      gameId: 401,
      betType: "total",
      side: "over",
      line: 52,
      odds: -110,
      units: 2,
      description: "Over 52",
      confidence: "bet",
    },
  ];

  it("every row on the slip is the member's, every one signed by the admin", async () => {
    const { logSlipBets } = await import("./bets");
    const res = await logSlipBets(2026, slip, member);
    expect(res.ok).toBe(true);
    const added = db.rows("bets").slice(2);
    expect(added).toHaveLength(2);
    for (const row of added) {
      expect(row.user_id).toBe(member);
      expect(row.logged_by).toBe(admin);
    }
    // one question, not one per row
    expect(rpcCalls).toHaveLength(1);
  });

  it("refused as a whole when the grant says no", async () => {
    grant = false;
    const { logSlipBets } = await import("./bets");
    const res = await logSlipBets(2026, slip, member);
    expect(res.ok).toBe(false);
    expect(db.rows("bets")).toHaveLength(2);
  });
});

describe("voidBet for a member", () => {
  it("voids the member's row, not one of the admin's own by the same id", async () => {
    const { voidBet } = await import("./bets");
    const res = await voidBet(900, member);
    expect(res.ok).toBe(true);
    const row = db.rows("bets").find((b) => b.id === 900)!;
    expect(row.result).toBe("void");
    expect(row.voided_at).toBeTruthy();
    expect(db.rows("bets").find((b) => b.id === 901)!.result).toBeNull();
  });

  it("without a member it is the admin's own row only", async () => {
    const { voidBet } = await import("./bets");
    await voidBet(900);
    // 900 is the member's; scoped to the admin's own id it matches nothing
    expect(db.rows("bets").find((b) => b.id === 900)!.result).toBeNull();
  });

  it("refused when the grant says no", async () => {
    grant = false;
    const { voidBet } = await import("./bets");
    const res = await voidBet(900, member);
    expect(res.ok).toBe(false);
    expect(db.rows("bets").find((b) => b.id === 900)!.result).toBeNull();
  });
});

/**
 * SETTLE-1. Owner report 2026-09-20: UCLA 52 Purdue 38, the ledger carrying
 * UCLA −14 (a push) against a book ticket at −13.5 (a win). The row is deleted
 * and re-logged at the real number on Sunday — and then sat open, because every
 * grading path was driven by the game finishing and this game finished the
 * night before.
 */
describe("a bet logged on a game that is already over", () => {
  beforeEach(() => {
    db.rows("games").push({
      id: 402,
      season_id: 2026,
      status: "final",
      home_points: 52,
      away_points: 38,
      start_ts: "2026-09-20T03:00:00Z",
    });
    db.rows("line_snapshots").push({
      id: 1,
      game_id: 402,
      provider: "DraftKings",
      spread: -14,
      spread_open: -13,
      total: 59.5,
      captured_at: "2026-09-20T02:30:00Z",
    });
  });

  it("settles on the way in rather than waiting for the next sweep", async () => {
    const { logBet } = await import("./bets");
    const res = await logBet(
      form({
        description: "UCLA -13.5",
        units: "1",
        season_id: "2026",
        game_id: "402",
        side: "home",
        line_taken: "13.5",
      }),
    );
    expect(res.ok).toBe(true);
    const row = db.rows("bets").at(-1)!;
    expect(row.result).toBe("win");
    expect(row.payout_units).toBe(0.91);
    expect(row.closing_line).toBe(-14);
  });

  it("a bet on a game still to be played goes in open, and asks nothing extra", async () => {
    const { logBet } = await import("./bets");
    await logBet(
      form({
        description: "UGA -3.5",
        units: "1",
        season_id: "2026",
        game_id: "401",
        side: "home",
        line_taken: "3.5",
      }),
    );
    expect(db.rows("bets").at(-1)!.result).toBeUndefined();
    // The status rides on the game read the action already makes, so the
    // ordinary case costs no second query and never builds a service client.
    expect(db.readCount("line_snapshots")).toBe(0);
  });

  it("the slip settles a final card the same way", async () => {
    const { logSlipBets } = await import("./bets");
    const res = await logSlipBets(2026, [
      {
        gameId: 402,
        betType: "spread",
        side: "home",
        line: -13.5,
        odds: -110,
        units: 1,
        description: "UCLA -13.5",
        confidence: "bet",
      },
    ]);
    expect(res.ok).toBe(true);
    expect(db.rows("bets").at(-1)!.result).toBe("win");
  });
});

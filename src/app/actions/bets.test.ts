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

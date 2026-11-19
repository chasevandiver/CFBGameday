import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../../../../scripts/lib/fake-supabase";

/**
 * JARVIS-1: the bet the door writes.
 *
 * Who the door lets in is `lib/jarvis-door.test.ts`; whether the database
 * accepts the row is the policy's business (`supabase/tests/log-bets-for.sql`),
 * and it is asked for real because the door signs in as the owner rather than
 * going around RLS. What is asserted here is the row — the same one the form
 * writes, with the away-spread flip and the proxy byline — and the three ways
 * the route says no before writing anything.
 *
 * Mocked at the door: `openDoor` mints a session, which has no meaning in a
 * test process. The schema half of that module stays real.
 */

const owner = "aaaaaaaa-0000-0000-0000-000000000001";
const hayden = "bbbbbbbb-0000-0000-0000-000000000002";
const stranger = "cccccccc-0000-0000-0000-000000000003";

let db: FakeSupabase;
let door: { ok: true } | { ok: false; status: number; error: string };
let granted: Set<string>;

vi.mock("../../../../lib/jarvis-door", async (real) => ({
  ...(await real<typeof import("../../../../lib/jarvis-door")>()),
  openDoor: async () =>
    door.ok
      ? {
          ok: true,
          ownerId: owner,
          supabase: {
            from: (t: string) => db.from(t),
            rpc: async (fn: string, args: { p_user: string }) => ({
              data: fn === "can_log_bet_for" && granted.has(args.p_user),
              error: null,
            }),
          },
        }
      : door,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

beforeEach(() => {
  db = new FakeSupabase({
    games: [
      { id: 401, season_id: 2026 },
      { id: 9001, season_id: 102026 },
    ],
    bets: [],
  });
  door = { ok: true };
  granted = new Set([hayden]);
});

const post = async (path: "log" | "void", body: unknown) => {
  const mod = path === "log" ? await import("./route") : await import("./void/route");
  const req = new Request("https://slate.test/api/jarvis/bets", {
    method: "POST",
    headers: { authorization: "Bearer x", "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await mod.POST(req as never);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const texasPlus4 = {
  game_id: 401,
  bet_type: "spread",
  side: "away",
  line: 4,
  description: "Texas +4",
};

describe("POST /api/jarvis/bets", () => {
  it("is not there when the door is shut, and says only that", async () => {
    door = { ok: false, status: 404, error: "Not found" };
    expect(await post("log", texasPlus4)).toEqual({ status: 404, json: { ok: false, error: "Not found" } });
    door = { ok: false, status: 401, error: "Unauthorized" };
    expect((await post("log", texasPlus4)).status).toBe(401);
    expect(db.rows("bets")).toHaveLength(0);
  });

  it("writes the owner's own bet the way the form does", async () => {
    const res = await post("log", texasPlus4);
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(db.rows("bets")).toEqual([
      {
        season_id: 2026,
        user_id: owner,
        logged_by: null,
        game_id: 401,
        bet_type: "spread",
        description: "Texas +4",
        side: "away",
        team_side: null,
        // Away +4 is the home side −4: stored home-perspective, like every spread.
        line_taken: -4,
        odds: -110,
        units: 1,
        book: null,
        confidence: "bet",
      },
    ]);
  });

  it("files a bet under its game's season, not the football pointer", async () => {
    await post("log", { ...texasPlus4, game_id: 9001, side: "home", line: -3, description: "Jaguars -3" });
    expect(db.rows("bets")[0]).toMatchObject({ season_id: 102026, line_taken: -3 });
  });

  it("logs for a member the grant allows, signed with the owner's byline", async () => {
    const res = await post("log", { ...texasPlus4, for_user: hayden, units: 2, odds: -115 });
    expect(res.status).toBe(200);
    expect(db.rows("bets")[0]).toMatchObject({ user_id: hayden, logged_by: owner, units: 2, odds: -115 });
  });

  it("refuses a person the grant does not allow, before writing", async () => {
    const res = await post("log", { ...texasPlus4, for_user: stranger });
    expect(res.status).toBe(403);
    expect(res.json.error).toMatch(/betting group you run/);
    expect(db.rows("bets")).toHaveLength(0);
  });

  it("refuses a game that is not on the slate, and a body that is not a bet", async () => {
    expect((await post("log", { ...texasPlus4, game_id: 777 })).status).toBe(404);
    expect((await post("log", { ...texasPlus4, line: undefined })).json.error).toBe("A spread needs its number");
    expect((await post("log", "not json")).status).toBe(400);
    expect(db.rows("bets")).toHaveLength(0);
  });

  it("will not put the same side of the same market on a ledger twice", async () => {
    expect((await post("log", texasPlus4)).status).toBe(200);
    const again = await post("log", texasPlus4);
    expect(again.status).toBe(409);
    expect(again.json.duplicate).toBe(true);
    expect(db.rows("bets")).toHaveLength(1);
    // Someone else on the same side is their own bet, and so is the other side.
    expect((await post("log", { ...texasPlus4, for_user: hayden })).status).toBe(200);
    expect((await post("log", { ...texasPlus4, side: "home", line: -4, description: "Baylor -4" })).status).toBe(200);
    expect(db.rows("bets")).toHaveLength(3);
  });

  it("lets a voided bet be logged again", async () => {
    db.rows("bets").push({ id: 5, user_id: owner, game_id: 401, bet_type: "spread", side: "away", voided_at: "2026-11-19T00:00:00Z" });
    expect((await post("log", texasPlus4)).status).toBe(200);
  });
});

describe("POST /api/jarvis/bets/void", () => {
  beforeEach(() => {
    db.rows("bets").push(
      { id: 900, user_id: owner, result: null, voided_at: null },
      { id: 901, user_id: hayden, result: null, voided_at: null },
      { id: 902, user_id: stranger, result: null, voided_at: null },
    );
  });
  const row = (id: number) => db.rows("bets").find((b) => b.id === id)!;

  it("voids the owner's own bet", async () => {
    expect((await post("void", { id: 900 })).status).toBe(200);
    expect(row(900).result).toBe("void");
    expect(row(900).voided_at).toEqual(expect.any(String));
  });

  it("voids a member's bet only when told whose it is", async () => {
    // Without the name it is looked for on the owner's ledger, and is not there.
    expect((await post("void", { id: 901 })).status).toBe(404);
    expect(row(901).result).toBeNull();
    expect((await post("void", { id: 901, for_user: hayden })).status).toBe(200);
    expect(row(901).result).toBe("void");
  });

  it("cannot reach a stranger's bet, and says so when nothing was touched", async () => {
    expect((await post("void", { id: 902, for_user: stranger })).status).toBe(403);
    expect((await post("void", { id: 902 })).status).toBe(404);
    expect((await post("void", { id: 12345 })).json).toEqual({ ok: false, error: "No such bet" });
    expect(row(902).result).toBeNull();
  });
});

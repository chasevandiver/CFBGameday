import { describe, expect, it, vi, beforeEach } from "vitest";
import { asClient, FakeSupabase } from "../../scripts/lib/fake-supabase";

/**
 * ADM-1: the archive-before-delete ordering.
 *
 * The whole basis for allowing a hard delete against `0001:210`'s append-only
 * rule is that the row is copied somewhere first. That guarantee lives in the
 * ORDER of three statements, which is the kind of thing a refactor folds into
 * one round trip for tidiness and silently breaks. So it is asserted directly:
 * make the archive write fail and the bet must still be there.
 *
 * The Supabase clients are mocked at the module boundary because the action
 * calls `createClient()` (cookies) and `createServiceClient()` (env keys), and
 * neither exists in a test process.
 */

const admin = "aaaaaaaa-0000-0000-0000-000000000001";
const notAdmin = "bbbbbbbb-0000-0000-0000-000000000002";

let db: FakeSupabase;
let signedInAs: string | null = admin;

vi.mock("./supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: signedInAs ? { id: signedInAs } : null } }) },
    from: (t: string) => db.from(t),
    // SEC-08b: the admin gate is `is_current_user_admin()` now, not a SELECT on
    // profiles — 0050 revoked the column from `authenticated`. This stub answers
    // it from the same seeded rows the old read used, so the admin and
    // non-admin cases below still mean what they did. A blanket
    // `{data: null}` would deny everyone and turn the four "an admin can do X"
    // tests green-by-accident in the failing direction.
    rpc: async (fn: string) =>
      fn === "is_current_user_admin"
        ? { data: signedInAs === admin, error: null }
        : { data: null, error: null },
  }),
}));

vi.mock("./supabase/service", () => ({
  createServiceClient: () => asClient(db),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const seed = () =>
  new FakeSupabase({
    profiles: [
      { id: admin, is_admin: true },
      { id: notAdmin, is_admin: false },
    ],
    bets: [{ id: 900, user_id: notAdmin, description: "Georgia -3", result: "win", units: 2 }],
    picks: [{ id: 700, user_id: notAdmin, game_id: 401, market: "spread", side: "home" }],
  });

beforeEach(() => {
  db = seed();
  signedInAs = admin;
});

describe("adminDeleteBet", () => {
  it("archives the whole row, then deletes it", async () => {
    const { adminDeleteBet } = await import("../app/actions/admin-wagers");

    const res = await adminDeleteBet(900);

    expect(res.ok).toBe(true);
    expect(res.removed).toBe(1);
    expect(db.rows("bets")).toHaveLength(0);

    const archived = db.rows("deleted_wagers");
    expect(archived).toHaveLength(1);
    expect(archived[0].kind).toBe("bet");
    expect(archived[0].deleted_by).toBe(admin);
    // The whole row, not a summary — nobody has to have predicted which field
    // would matter later.
    expect((archived[0].payload as Record<string, unknown>).description).toBe("Georgia -3");
    expect((archived[0].payload as Record<string, unknown>).result).toBe("win");
  });

  /* The ordering guarantee. If this ever passes with the bet gone, the
     append-only exception this feature is built on has quietly stopped
     holding. */
  it("does NOT delete when the archive write fails", async () => {
    db.failures.set("deleted_wagers:insert", "archive is down");
    const { adminDeleteBet } = await import("../app/actions/admin-wagers");

    const res = await adminDeleteBet(900);

    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archive/i);
    expect(db.rows("bets")).toHaveLength(1);
  });

  it("deletes a settled bet — the case a void cannot reach", async () => {
    const { adminDeleteBet } = await import("../app/actions/admin-wagers");
    // The seeded bet is already result: "win". voidBet could not touch it: the
    // 0045 trigger raises on any update where old.result is not null.
    expect(db.rows("bets")[0].result).toBe("win");

    const res = await adminDeleteBet(900);

    expect(res.ok).toBe(true);
    expect(db.rows("bets")).toHaveLength(0);
  });

  it("refuses a non-admin, and touches nothing", async () => {
    signedInAs = notAdmin;
    const { adminDeleteBet } = await import("../app/actions/admin-wagers");

    const res = await adminDeleteBet(900);

    expect(res.ok).toBe(false);
    expect(res.message).toBe("Admins only");
    expect(db.rows("bets")).toHaveLength(1);
    expect(db.rows("deleted_wagers")).toHaveLength(0);
  });

  it("refuses a signed-out caller", async () => {
    signedInAs = null;
    const { adminDeleteBet } = await import("../app/actions/admin-wagers");

    const res = await adminDeleteBet(900);

    expect(res.ok).toBe(false);
    expect(res.message).toBe("Not signed in");
    expect(db.rows("bets")).toHaveLength(1);
  });

  /* A bet that is already gone is the state the caller asked for. Reporting an
     error there would put a red toast on a successful outcome — the same
     reasoning 0038:24-30 gives for remove_pick's zero-row case. */
  it("treats an already-deleted bet as success, and archives nothing", async () => {
    const { adminDeleteBet } = await import("../app/actions/admin-wagers");

    const res = await adminDeleteBet(12345);

    expect(res.ok).toBe(true);
    expect(res.removed).toBe(0);
    expect(db.rows("deleted_wagers")).toHaveLength(0);
  });
});

describe("adminDeletePick", () => {
  it("archives and deletes, same ordering", async () => {
    const { adminDeletePick } = await import("../app/actions/admin-wagers");

    const res = await adminDeletePick(700);

    expect(res.ok).toBe(true);
    expect(db.rows("picks")).toHaveLength(0);
    expect(db.rows("deleted_wagers")[0].kind).toBe("pick");
  });

  it("does NOT delete when the archive write fails", async () => {
    db.failures.set("deleted_wagers:insert", "archive is down");
    const { adminDeletePick } = await import("../app/actions/admin-wagers");

    const res = await adminDeletePick(700);

    expect(res.ok).toBe(false);
    expect(db.rows("picks")).toHaveLength(1);
  });

  it("refuses a non-admin", async () => {
    signedInAs = notAdmin;
    const { adminDeletePick } = await import("../app/actions/admin-wagers");

    const res = await adminDeletePick(700);

    expect(res.ok).toBe(false);
    expect(db.rows("picks")).toHaveLength(1);
  });
});

/**
 * ADM-3: correcting the line a bet was logged at.
 *
 * Two things are load-bearing and neither is arithmetic. The archive lands
 * before the row changes, for the same reason ADM-1's does — the ordering IS
 * the record. And the re-grade goes through `settleBetsOnFinalGame`, the
 * function the log path and the scheduled pass both call, so a corrected bet
 * cannot settle by a second opinion.
 *
 * The worked case is the one that prompted it: GB @ NYJ, Green Bay 20–17, an
 * away spread logged at -3.5 (a loss) that should have been -3 (a push).
 */
const gbSeed = () =>
  new FakeSupabase({
    profiles: [
      { id: admin, is_admin: true },
      { id: notAdmin, is_admin: false },
    ],
    games: [
      {
        id: 401872936,
        status: "final",
        home_points: 17, // NYJ
        away_points: 20, // GB
        start_ts: "2026-09-20T17:00:00.000Z",
      },
    ],
    line_snapshots: [
      {
        id: 1,
        game_id: 401872936,
        provider: "DraftKings",
        spread: 3.5,
        spread_open: 6.5,
        total: 44.5,
        captured_at: "2026-09-20T16:57:40.463Z",
      },
    ],
    bets: [
      {
        id: 262,
        user_id: admin,
        game_id: 401872936,
        bet_type: "spread",
        description: "Green Bay Packers -3.5 (GB @ NYJ)",
        side: "away",
        team_side: null,
        // Home-perspective: an away backer on GB -3.5 stores +3.5.
        line_taken: 3.5,
        odds: -110,
        units: 1,
        result: "loss",
        payout_units: -1,
        clv: 0,
        closing_line: 3.5,
        voided_at: null,
      },
    ],
  });

describe("correctBetLine", () => {
  beforeEach(() => {
    db = gbSeed();
    signedInAs = admin;
  });

  it("re-settles a loss into the push it should have been", async () => {
    const { correctBetLine } = await import("../app/actions/admin-wagers");

    const res = await correctBetLine(262, -3);

    expect(res.ok).toBe(true);
    expect(res.result).toBe("push");

    const row = db.rows("bets")[0];
    // Stored home-perspective again: the away backer's -3 is +3 on the row.
    expect(row.line_taken).toBe(3);
    expect(row.result).toBe("push");
    expect(row.payout_units).toBe(0);
    // Took -3, closed -3.5: half a point the right way, and the grader's own
    // number rather than one computed here.
    expect(row.clv).toBe(0.5);
    expect(row.closing_line).toBe(3.5);
  });

  it("keeps the row's identity — same id, same placed_at, same owner", async () => {
    const { correctBetLine } = await import("../app/actions/admin-wagers");
    const before = { ...db.rows("bets")[0] };
    await correctBetLine(262, -3);
    const after = db.rows("bets")[0];
    expect(after.id).toBe(before.id);
    expect(after.user_id).toBe(before.user_id);
    expect(after.units).toBe(before.units);
    expect(after.odds).toBe(before.odds);
  });

  it("rewrites the number in the description and leaves the rest alone", async () => {
    const { correctBetLine } = await import("../app/actions/admin-wagers");
    await correctBetLine(262, -3);
    expect(db.rows("bets")[0].description).toBe("Green Bay Packers -3 (GB @ NYJ)");
  });

  it("archives the row as it stood, before changing it", async () => {
    const { correctBetLine } = await import("../app/actions/admin-wagers");
    await correctBetLine(262, -3);

    const archived = db.rows("bet_corrections");
    expect(archived).toHaveLength(1);
    expect(archived[0].bet_id).toBe(262);
    expect(archived[0].corrected_by).toBe(admin);
    expect(archived[0].old_line).toBe(-3.5);
    expect(archived[0].new_line).toBe(-3);
    // The pre-correction row, verdict included — that is what makes this
    // reversible by hand.
    const payload = archived[0].payload as Record<string, unknown>;
    expect(payload.line_taken).toBe(3.5);
    expect(payload.result).toBe("loss");
    expect(payload.description).toBe("Green Bay Packers -3.5 (GB @ NYJ)");
  });

  it("changes nothing when the archive write fails", async () => {
    const { correctBetLine } = await import("../app/actions/admin-wagers");
    db.failures.set("bet_corrections:insert", "archive is down");

    const res = await correctBetLine(262, -3);

    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archive write failed/);
    const row = db.rows("bets")[0];
    expect(row.line_taken).toBe(3.5);
    expect(row.result).toBe("loss");
  });

  it("refuses a non-admin, and touches nothing", async () => {
    signedInAs = notAdmin;
    const { correctBetLine } = await import("../app/actions/admin-wagers");
    const res = await correctBetLine(262, -3);
    expect(res.ok).toBe(false);
    expect(res.message).toBe("Admins only");
    expect(db.rows("bets")[0].line_taken).toBe(3.5);
    expect(db.rows("bet_corrections")).toHaveLength(0);
  });

  it("refuses a quarter-point — books hang halves, so that is a typo", async () => {
    const { correctBetLine } = await import("../app/actions/admin-wagers");
    const res = await correctBetLine(262, -3.25);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/half-points/);
    expect(db.rows("bets")[0].line_taken).toBe(3.5);
  });

  it("refuses a bet type that carries no line", async () => {
    db.rows("bets")[0].bet_type = "moneyline";
    const { correctBetLine } = await import("../app/actions/admin-wagers");
    const res = await correctBetLine(262, -3);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/carries no line/);
    expect(db.rows("bet_corrections")).toHaveLength(0);
  });

  it("refuses a voided bet", async () => {
    db.rows("bets")[0].voided_at = "2026-09-20T18:00:00.000Z";
    const { correctBetLine } = await import("../app/actions/admin-wagers");
    const res = await correctBetLine(262, -3);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/voided/);
  });

  it("is a no-op on the number the row already carries", async () => {
    const { correctBetLine } = await import("../app/actions/admin-wagers");
    const res = await correctBetLine(262, -3.5);
    expect(res.ok).toBe(true);
    expect(res.message).toBe("Already that number");
    expect(db.rows("bet_corrections")).toHaveLength(0);
    expect(db.rows("bets")[0].result).toBe("loss");
  });

  it("leaves a corrected bet open when its game is not final", async () => {
    db.rows("games")[0].status = "in_progress";
    const { correctBetLine } = await import("../app/actions/admin-wagers");
    const res = await correctBetLine(262, -3);
    expect(res.ok).toBe(true);
    expect(res.result).toBeNull();
    expect(db.rows("bets")[0].result).toBeNull();
    expect(db.rows("bets")[0].line_taken).toBe(3);
  });
});

describe("correctedDescription", () => {
  it("swaps the number when it appears exactly once", async () => {
    const { correctedDescription } = await import("./bet-line");
    expect(correctedDescription("Green Bay Packers -3.5 (GB @ NYJ)", -3.5, -3)).toBe(
      "Green Bay Packers -3 (GB @ NYJ)",
    );
    expect(correctedDescription("UNC +6.5", 6.5, 7)).toBe("UNC +7");
  });

  it("leaves the sentence alone when the number is not in it, or is in it twice", async () => {
    const { correctedDescription } = await import("./bet-line");
    // Hand-typed, no number to find.
    expect(correctedDescription("packers game", -3.5, -3)).toBe("packers game");
    // Ambiguous: which -3.5 did they mean?
    expect(correctedDescription("GB -3.5 / NYJ -3.5", -3.5, -3)).toBe("GB -3.5 / NYJ -3.5");
  });

  it("does not match inside a longer number", async () => {
    const { correctedDescription } = await import("./bet-line");
    // "-3" must not eat the "-3.5" it prefixes.
    expect(correctedDescription("Team -3.5 (x)", -3, -2.5)).toBe("Team -3.5 (x)");
    // "13.5" must not match inside "213.5".
    expect(correctedDescription("Over 213.5", 13.5, 14)).toBe("Over 213.5");
  });
});

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

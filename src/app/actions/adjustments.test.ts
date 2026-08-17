import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../../scripts/lib/fake-supabase";

/**
 * The season pointer a manual rating adjustment lands against.
 *
 * `is_current` is per sport — 2026 CFB and 2026 NFL both carry true — so the
 * unscoped read this used to do was ambiguous, and `.maybeSingle()` over two
 * rows is a PostgREST error rather than a coin flip. The action therefore saw
 * `season === null` and answered "No current season configured" for every
 * adjustment anybody tried to make.
 *
 * `FakeSupabase.maybeSingle()` is more forgiving than PostgREST: it returns
 * the FIRST match instead of erroring. That is why the NFL row is seeded first
 * below — under the fake, an unscoped query picks it, so the test still tells
 * the two versions apart. Both behaviours are failures; what is being pinned
 * is that the query is scoped to CFB at all.
 */

const admin = "aaaaaaaa-0000-0000-0000-000000000001";

let db: FakeSupabase;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: admin } } }) },
    from: (t: string) => db.from(t),
    rpc: async () => ({ data: true, error: null }),
  }),
}));

const { addAdjustment } = await import("./adjustments");

beforeEach(() => {
  db = new FakeSupabase({
    seasons: [
      // NFL first on purpose — see the header.
      { id: 102026, label: "2026 NFL", is_current: true, sport: "nfl" },
      { id: 2026, label: "2026", is_current: true, sport: "cfb" },
      { id: 2025, label: "2025", is_current: false, sport: "cfb" },
      { id: 2024, label: "2024", is_current: false, sport: "cfb" },
    ],
    rating_adjustments: [],
  });
});

describe("addAdjustment — which season it lands on", () => {
  it("books against the current CFB season, not the NFL one", async () => {
    const res = await addAdjustment(333, -3, "QB out");
    expect(res.ok).toBe(true);

    const rows = db.rows("rating_adjustments");
    expect(rows).toHaveLength(1);
    // The whole bug in one assertion: 102026 here means the pointer was
    // resolved without a sport, and the ratings replay is CFB-only.
    expect(rows[0]!.season_id).toBe(2026);
  });

  it("never books against a past season", async () => {
    await addAdjustment(333, 2, "line coach back");
    expect([2025, 2024]).not.toContain(db.rows("rating_adjustments")[0]!.season_id);
  });

  it("still refuses the input it always refused", async () => {
    expect((await addAdjustment(333, 0, "nothing")).ok).toBe(false);
    expect((await addAdjustment(333, 20, "too much")).ok).toBe(false);
    expect((await addAdjustment(333, -3, "   ")).ok).toBe(false);
    expect(db.rows("rating_adjustments")).toHaveLength(0);
  });

  it("says CFB when there is no CFB season to book against", async () => {
    db = new FakeSupabase({
      seasons: [{ id: 102026, label: "2026 NFL", is_current: true, sport: "nfl" }],
      rating_adjustments: [],
    });
    const res = await addAdjustment(333, -3, "QB out");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("CFB");
  });
});

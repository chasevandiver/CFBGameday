/**
 * The first test in the repo that exercises a route (docs/STATUS.md §23 #42),
 * and this one earns it: everything that can go wrong here is invisible to a
 * unit test. satori renders a narrower CSS subset than a browser and throws on
 * an element with more than one child and no explicit `display: flex`; the
 * fonts are read off disk and are a deploy artifact rather than an import; and
 * a missing glyph is a silent tofu box. None of that is reachable from
 * share-card.test.ts, which only ever sees plain objects.
 *
 * So this asks the only question that matters: does a real payload come back
 * as real PNG bytes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfidenceTier } from "../../../lib/db-types";

const getUser = vi.fn();
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const bet = (over: Record<string, unknown> = {}) => ({
  key: "1:spread",
  tier: "bet" as ConfidenceTier,
  pick: "Georgia −6.5",
  matchup: "Tennessee at Georgia",
  away: { abbr: "TENN", logo: null, color: "#FF8200" },
  home: { abbr: "UGA", logo: null, color: "#BA0C2F" },
  units: 1,
  odds: -110,
  kickTs: "2026-09-12T19:30:00Z",
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  title: "Chase Bets",
  subtitle: "Week 3 · Sat Sep 12",
  bets: [bet()],
  ...over,
});

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/share-card", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
};

// PNG magic number. A zero-byte or HTML response would sail past a status check.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

async function expectPng(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("image/png");
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect([...bytes.slice(0, 4)]).toEqual(PNG_MAGIC);
  // A 1080×1350 card with type on it is tens of KB; anything tiny means satori
  // produced an empty canvas rather than failing outright.
  expect(bytes.byteLength).toBeGreaterThan(10_000);
  return bytes;
}

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/share-card", () => {
  it("refuses an unauthenticated caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await post(payload());
    expect(res.status).toBe(401);
  });

  it("rejects a payload with no bets", async () => {
    expect((await post(payload({ bets: [] }))).status).toBe(400);
  });

  it("rejects a tier outside the ladder", async () => {
    expect((await post(payload({ bets: [bet({ tier: "hammer" })] }))).status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/share-card", { method: "POST", body: "{" }),
    );
    expect(res.status).toBe(400);
  });

  it("draws a single-bet card", async () => {
    await expectPng(await post(payload()));
  });

  // The four hero states from public/design/share-card-d.html, each rendered
  // for real. A layout that satori refuses throws here rather than in a share
  // sheet on a Saturday.
  it("draws the hero state — one bet alone at the top tier", async () => {
    await expectPng(
      await post(
        payload({
          bets: [
            bet({ key: "a", tier: "century" }),
            bet({ key: "b", tier: "day", kickTs: "2026-09-13T00:00:00Z" }),
            bet({ key: "c", tier: "bet", kickTs: "2026-09-12T16:00:00Z" }),
          ],
        }),
      ),
    );
  });

  it("draws the tied-top state, which has no hero", async () => {
    await expectPng(
      await post(
        payload({
          bets: [
            bet({ key: "a", tier: "century" }),
            bet({ key: "b", tier: "century", kickTs: "2026-09-12T16:00:00Z" }),
            bet({ key: "c", tier: "lean", kickTs: null }),
          ],
        }),
      ),
    );
  });

  it("draws the flat slate — every bet one tier, no hero, one heading", async () => {
    await expectPng(
      await post(
        payload({
          bets: Array.from({ length: 7 }, (_, i) =>
            bet({ key: `b${i}`, kickTs: `2026-09-12T1${i}:00:00Z` }),
          ),
        }),
      ),
    );
  });

  it("draws a full card at the cap", async () => {
    await expectPng(
      await post(
        payload({
          bets: Array.from({ length: 12 }, (_, i) =>
            bet({ key: `b${i}`, tier: i === 0 ? "century" : "bet", units: 1.5 }),
          ),
          overflow: 3,
        }),
      ),
    );
  });

  // The two rows that have historically broken layouts: the longest matchup
  // the product can build, and a future with no game, no logos and no kickoff.
  it("draws the awkward rows — the longest matchup and a logo-less future", async () => {
    await expectPng(
      await post(
        payload({
          bets: [
            bet({
              key: "long",
              tier: "slate",
              pick: "Miami (OH) +13.5",
              matchup: "Miami (OH) at Western Michigan",
            }),
            bet({
              key: "future",
              tier: "lean",
              pick: "OSU win total o10.5",
              matchup: "Season futures",
              away: null,
              home: null,
              kickTs: null,
              odds: 120,
            }),
          ],
        }),
      ),
    );
  });

  it("draws a name carrying a glyph the fonts do not have", async () => {
    // Hawaiʻi's ʻokina is the one gap in the four TTFs; sanitizeForCard swaps
    // it. If that ever regresses this still renders — as a tofu box — so the
    // assertion is that it renders at all, and the substitution itself is
    // pinned in share-card.test.ts.
    await expectPng(
      await post(payload({ bets: [bet({ matchup: "Hawaiʻi at Stanford", pick: "Hawaiʻi +21" })] })),
    );
  });

  it("never fetches a logo from a host outside the allowlist", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expectPng(
      await post(
        payload({
          bets: [
            bet({
              away: { abbr: "AAA", logo: "http://169.254.169.254/latest/meta-data/", color: null },
              home: { abbr: "BBB", logo: "https://evil.test/x.png", color: null },
            }),
          ],
        }),
      ),
    );
    const reached = spy.mock.calls.map((c) => String(c[0]));
    expect(reached.some((u) => u.includes("169.254.169.254"))).toBe(false);
    expect(reached.some((u) => u.includes("evil.test"))).toBe(false);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Render smoke test: the page against a fixture database. The arithmetic is
 * tested in `lib/model-stats.test.ts`; this checks the page reads the right
 * tables, folds them the way it says it does, and renders every section
 * without a runtime error — the thing a typecheck cannot prove.
 */

type Row = Record<string, unknown>;

const TABLES: Record<string, Row[]> = {
  seasons: [
    { id: 2026, sport: "cfb" },
    { id: 2025, sport: "cfb" },
  ],
  predictions: [
    // Game 1: model −7 vs market −3, home lean, home won by 14 → ATS win.
    {
      id: 1, game_id: 1, season_id: 2026, frozen: true, model_version: "2026.6.0",
      spread: -7, total: 52, home_win_prob: 0.7, vegas_spread: -3, open_spread: -2.5,
      close_spread: -4, edge: -4, edge_flag: "EDGE", consensus_flag: true, clv: 1,
      created_at: "2026-09-10T03:00:00Z",
    },
    // Game 2: model −1 vs market −3, away lean, home won by 1 → ATS win; SU win.
    {
      id: 2, game_id: 2, season_id: 2026, frozen: true, model_version: "2026.6.0",
      spread: -1, total: null, home_win_prob: 0.53, vegas_spread: -3, open_spread: -3,
      close_spread: -3.5, edge: 2, edge_flag: "EDGE", consensus_flag: false, clv: -0.5,
      created_at: "2026-09-10T03:00:00Z",
    },
    // Game 3: not played yet.
    {
      id: 3, game_id: 3, season_id: 2026, frozen: true, model_version: "2026.6.0",
      spread: -10, total: null, home_win_prob: 0.8, vegas_spread: -9, open_spread: -8,
      close_spread: null, edge: -1, edge_flag: null, consensus_flag: true, clv: null,
      created_at: "2026-09-17T03:00:00Z",
    },
  ],
  games: [
    {
      id: 1, week: 2, season_type: "regular", start_ts: "2026-09-12T19:30:00Z", status: "final",
      home_points: 31, away_points: 17, home_team_id: 10, away_team_id: 11, neutral_site: false,
      conference_game: true,
    },
    {
      id: 2, week: 2, season_type: "regular", start_ts: "2026-09-12T23:30:00Z", status: "final",
      home_points: 21, away_points: 20, home_team_id: 12, away_team_id: 10, neutral_site: true,
      conference_game: false,
    },
    {
      id: 3, week: 3, season_type: "regular", start_ts: "2026-09-19T16:00:00Z", status: "scheduled",
      home_points: null, away_points: null, home_team_id: 11, away_team_id: 12, neutral_site: false,
      conference_game: false,
    },
  ],
  teams: [
    { id: 10, school: "Georgia", conference: "SEC", classification: "fbs" },
    { id: 11, school: "Alabama", conference: "SEC", classification: "fbs" },
    { id: 12, school: "Toledo", conference: "MAC", classification: "fbs" },
  ],
  line_consensus: [
    { game_id: 1, total: 49.5, as_of: "2026-09-12T18:00:00Z" },
    { game_id: 2, total: 44, as_of: "2026-09-12T22:00:00Z" },
  ],
};

/** Enough of the PostgREST builder for this page: filters, then a thenable. */
function fakeFrom(table: string) {
  let rows = TABLES[table] ?? [];
  let head = false;
  const b = {
    select(_cols: string, opts?: { head?: boolean }) {
      head = Boolean(opts?.head);
      return b;
    },
    eq(col: string, v: unknown) {
      rows = rows.filter((r) => r[col] === v);
      return b;
    },
    in(col: string, vs: unknown[]) {
      rows = rows.filter((r) => vs.includes(r[col]));
      return b;
    },
    order() {
      return b;
    },
    then(resolve: (v: { data: Row[] | null; error: null; count: number }) => void) {
      resolve({ data: head ? null : rows, error: null, count: rows.length });
    },
  };
  return b;
}

vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ from: fakeFrom }),
}));
vi.mock("../../../lib/queries", () => ({
  fetchCurrentSeasonWeek: async () => ({ seasonId: 2026, week: 3, seasonType: "regular", minWeek: 0 }),
}));
// The nav needs the router and a ticker; neither is what this test is about.
vi.mock("../../../components/AppNav", () => ({ AppNav: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("/model/stats", () => {
  it("renders the season record and its cuts from the frozen receipts", async () => {
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    // Two final games, one pending: graded 2 of 3, leans 2-0, favourites 2-0.
    expect(html).toContain("Model stats");
    expect(html).toContain("2</p><p class=\"stat text-[10.5px] leading-tight text-dim\">of 3 frozen");
    expect(html).toMatch(/Leans ATS[\s\S]*?2-0/);
    expect(html).toMatch(/Straight up[\s\S]*?2-0/);
    // Both flagged; the close: game 1 model −7 vs −4 → home covers (−4 +14);
    // game 2 model −1 vs −3.5 → away, home won by 1 → away covers. 2-0.
    expect(html).toMatch(/Vs the close[\s\S]*?2-0/);
    // Totals: only game 1 priced a total (52 vs close 49.5 → over; 48 scored → loss).
    expect(html).toMatch(/Totals[\s\S]*?0-1/);

    // Every group renders, and the cuts place the games where they belong.
    for (const title of ["Week by week", "The disagreement", "The matchup", "When it kicks", "Totals", "Calibration"]) {
      expect(html).toContain(title);
    }
    expect(html).toContain("Week 2");
    expect(html).toContain("cross-tier");
    expect(html).toContain("Neutral site");
    expect(html).toContain("Came toward the model");
    // One version only: no version table, and the tile names it.
    expect(html).not.toContain("By model version");
    expect(html).toContain("2026.6.0");
    // Only one season has receipts, so no switcher.
    expect(html).not.toContain('aria-label="Season"');
  });

  it("says so when nothing has graded yet", async () => {
    const { default: Page } = await import("./page");
    const saved = TABLES.games;
    TABLES.games = saved.map((g) => ({ ...g, status: "scheduled", home_points: null, away_points: null }));
    try {
      const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
      expect(html).toContain("Nothing has graded yet");
      expect(html).toContain("3 frozen predictions");
    } finally {
      TABLES.games = saved;
    }
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Render smoke test: the page against a fixture database. The arithmetic is
 * tested in `lib/model-stats.test.ts`; this checks the page reads the right
 * tables, folds them the way it says it does, gates the splits on sample
 * size, and renders without a runtime error — the thing a typecheck cannot
 * prove.
 */

type Row = Record<string, unknown>;

/**
 * Twelve final week-1 games the model leaned home on at −7 against a −3
 * market: eight home covers, three misses, one push. One unlined FCS game the
 * model got right straight-up, and one week-2 game still to play.
 */
function fixture(): Record<string, Row[]> {
  const predictions: Row[] = [];
  const games: Row[] = [];
  const pred = (id: number, over: Row): Row => ({
    id, game_id: id, season_id: 2026, frozen: true, model_version: "2026.6.0",
    spread: -7, total: null, home_win_prob: 0.7, vegas_spread: -3, open_spread: -2.5,
    close_spread: -4, edge: -4, edge_flag: "EDGE", consensus_flag: true, clv: 1,
    created_at: "2026-09-03T03:00:00Z", ...over,
  });
  const game = (id: number, over: Row): Row => ({
    id, week: 1, season_type: "regular", start_ts: "2026-09-05T19:30:00Z", status: "final",
    home_points: 31, away_points: 17, home_team_id: 10, away_team_id: 11, neutral_site: false,
    conference_game: true, ...over,
  });
  for (let i = 1; i <= 12; i += 1) {
    predictions.push(pred(i, {}));
    // margins: 8 cover (+14), 3 miss (+1), 1 push (+3)
    const margin = i <= 8 ? 14 : i <= 11 ? 1 : 3;
    games.push(game(i, { home_points: 17 + margin }));
  }
  predictions.push(pred(13, { vegas_spread: null, edge: null, edge_flag: null, open_spread: null, close_spread: null, clv: null, home_win_prob: 0.97 }));
  games.push(game(13, { away_team_id: 12, home_points: 45, away_points: 3 }));
  predictions.push(pred(14, { created_at: "2026-09-10T03:00:00Z" }));
  games.push(game(14, { week: 2, status: "scheduled", home_points: null, away_points: null, start_ts: "2026-09-12T19:30:00Z" }));
  return {
    seasons: [{ id: 2026, sport: "cfb" }, { id: 2025, sport: "cfb" }],
    predictions,
    games,
    teams: [
      { id: 10, school: "Georgia", conference: "SEC", classification: "fbs" },
      { id: 11, school: "Alabama", conference: "SEC", classification: "fbs" },
      { id: 12, school: "Mercer", conference: "SoCon", classification: "fcs" },
    ],
    line_consensus: [],
  };
}

let TABLES = fixture();

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
  fetchCurrentSeasonWeek: async () => ({ seasonId: 2026, week: 2, seasonType: "regular", minWeek: 0 }),
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

async function render(): Promise<string> {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

describe("/model/stats", () => {
  it("leads with the record against the spread and says how many games had a line", async () => {
    const html = await render();
    expect(html).toContain("Record against the spread");
    expect(html).toMatch(/Record against the spread[\s\S]*?8-3-1/);
    expect(html).toContain("12 games with a line · 1 without");
    // 13 finals, every favourite won.
    expect(html).toMatch(/Straight up[\s\S]*?13-0/);
    expect(html).toContain("13 of 14");
  });

  it("shows only the splits a bucket has earned, and folds the small ones", async () => {
    const html = await render();
    // Week 1 has 13 games: shown. Edge size 4–6 has 12: shown. Tier P4 vs P4
    // has 12 and FBS vs FCS has 1 → the FCS game folds into Other.
    expect(html).toContain("Week 1");
    expect(html).toContain("4–6");
    // ...and, being the one game with no line, that Other has no record to
    // print, so the row is dropped: the footnote carries it.
    expect(html).toContain("P4 vs P4");
    expect(html).not.toContain("FBS vs FCS");
    expect(html).not.toContain(">Other<");
    // Nothing prints 0% on n=1: the per-row percentage rides beside the record.
    expect(html).not.toContain("±");
    // The fold exists, with the splits that cleared the bar behind it.
    expect(html).toContain("More splits");
    expect(html).toContain("Home field");
    // No totals were priced, so no totals table; win-prob 90–100% has only one
    // game and 70–80% has 12, so calibration shows the one band.
    expect(html).not.toContain("Totals · lean");
    expect(html).toContain("Win probability");
    expect(html).toContain("70–80%");
    expect(html).not.toContain("90–100%");
  });

  it("carries the secondary numbers in one list", async () => {
    const html = await render();
    for (const label of ["Vs the closing line", "Flagged edges", "Spread error", "Totals", "Graded"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("no totals priced yet");
  });

  it("says so when the sample is too thin for any split", async () => {
    const saved = TABLES;
    TABLES = { ...saved, games: saved.games.map((g, i) => (i < 9 ? { ...g, status: "scheduled", home_points: null, away_points: null } : g)) };
    try {
      const html = await render();
      expect(html).toContain("Splits appear after about 40 graded games");
      expect(html).not.toContain("More splits");
    } finally {
      TABLES = saved;
    }
  });

  it("says so when nothing has graded yet", async () => {
    const saved = TABLES;
    TABLES = { ...saved, games: saved.games.map((g) => ({ ...g, status: "scheduled", home_points: null, away_points: null })) };
    try {
      const html = await render();
      expect(html).toContain("Nothing has graded yet");
      expect(html).toContain("14 frozen predictions");
    } finally {
      TABLES = saved;
    }
  });
});

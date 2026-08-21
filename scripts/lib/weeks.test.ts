import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvedWeek, weekZeroIds, type SchedulableGame } from "./weeks";

const g = (
  id: number,
  startDate: string | null,
  week = 1,
  seasonType = "regular",
): SchedulableGame => ({ id, week, seasonType, startDate });

/**
 * The real 2026 shape, from the live games table on 2026-08-12: CFBD week 1 is
 * 99 games across Aug 29 → Sep 7, with the Georgia opener on Sep 5.
 */
const cfbd2026 = (): SchedulableGame[] => [
  ...Array.from({ length: 7 }, (_, i) => g(100 + i, `2026-08-29T${16 + (i % 6)}:00:00Z`)),
  g(107, "2026-08-30T23:00:00Z"),
  ...Array.from({ length: 6 }, (_, i) => g(200 + i, `2026-09-03T23:00:00Z`)),
  ...Array.from({ length: 8 }, (_, i) => g(300 + i, `2026-09-04T23:00:00Z`)),
  ...Array.from({ length: 60 }, (_, i) => g(400 + i, `2026-09-05T${16 + (i % 8)}:00:00Z`)),
  ...Array.from({ length: 16 }, (_, i) => g(500 + i, `2026-09-06T${18 + (i % 5)}:00:00Z`)),
  g(600, "2026-09-07T23:00:00Z"),
];

describe("weekZeroIds", () => {
  it("splits CFBD's merged 2026 week 1 at the Aug 30 → Sep 3 hole", () => {
    const wk0 = weekZeroIds(cfbd2026());
    expect(wk0.size).toBe(8);
    // The seven Aug 29 games plus the lone Aug 30 game, and nothing else.
    for (let i = 0; i < 7; i++) expect(wk0.has(100 + i)).toBe(true);
    expect(wk0.has(107)).toBe(true);
    // Georgia's Sep 5 opener stays in week 1 — the whole point.
    expect(wk0.has(400)).toBe(false);
    expect(wk0.has(200)).toBe(false);
  });

  it("is a no-op when CFBD already labels week 0 properly", () => {
    const games = [
      g(1, "2026-08-29T18:00:00Z", 0),
      g(2, "2026-09-03T23:00:00Z", 1),
      g(3, "2026-09-05T18:00:00Z", 1),
      g(4, "2026-09-06T18:00:00Z", 1),
    ];
    expect(weekZeroIds(games).size).toBe(0);
  });

  it("leaves an ordinary Tue–Sun week alone", () => {
    const games = [
      g(1, "2026-09-08T23:00:00Z"),
      g(2, "2026-09-10T23:00:00Z"),
      g(3, "2026-09-12T16:00:00Z"),
      g(4, "2026-09-12T23:30:00Z"),
      g(5, "2026-09-13T20:00:00Z"),
    ];
    expect(weekZeroIds(games).size).toBe(0);
  });

  it("does not split a long week with no clean seam", () => {
    // Spans 10 days but carries a game every single day — no hole, so no guess.
    const games = [
      "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02",
      "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07",
    ].map((d, i) => g(i + 1, `${d}T23:00:00Z`));
    expect(weekZeroIds(games).size).toBe(0);
  });

  it("never touches week 2+, or the postseason", () => {
    const games = [
      g(1, "2026-11-28T18:00:00Z", 14),
      g(2, "2026-12-05T18:00:00Z", 14),
      g(3, "2026-12-19T18:00:00Z", 1, "postseason"),
      g(4, "2027-01-11T18:00:00Z", 1, "postseason"),
    ];
    expect(weekZeroIds(games).size).toBe(0);
  });

  it("ignores TBD kickoffs rather than placing them", () => {
    const games = [...cfbd2026(), g(999, null)];
    const wk0 = weekZeroIds(games);
    expect(wk0.has(999)).toBe(false);
    expect(wk0.size).toBe(8);
  });

  it("needs two games to find a seam", () => {
    expect(weekZeroIds([g(1, "2026-08-29T18:00:00Z")]).size).toBe(0);
    expect(weekZeroIds([]).size).toBe(0);
  });
});

describe("resolvedWeek", () => {
  it("rewrites only the week-0 games", () => {
    const games = cfbd2026();
    const wk0 = weekZeroIds(games);
    const byWeek = new Map<number, number>();
    for (const game of games) {
      const w = resolvedWeek(game, wk0);
      byWeek.set(w, (byWeek.get(w) ?? 0) + 1);
    }
    expect(byWeek.get(0)).toBe(8);
    expect(byWeek.get(1)).toBe(91);
    expect(byWeek.size).toBe(2);
  });

  it("is identity when nothing splits", () => {
    const game = g(1, "2026-09-12T18:00:00Z", 2);
    expect(resolvedWeek(game, new Set())).toBe(2);
  });
});

/**
 * The split is only worth anything if EVERY writer of `games.week` applies it.
 * It did not: `build-preseason.ts` emitted `week: g.week` straight from CFBD,
 * and `preseason-refresh` reloads that file over the games table daily — so
 * `sync-games` split Week 0 out at 09:35 UTC and the 11:15 preseason load put
 * it back, every morning, both jobs green. It only became visible on 2026-08-20,
 * the first day the preseason gate stopped declining and the load actually ran.
 *
 * A unit test on `weekZeroIds` could never have caught that; the function was
 * right the whole time. So this scans for the shape instead: any file that
 * writes rows into `games` must route the week through `resolvedWeek`.
 */
describe("every games writer applies the split", () => {
  const SCRIPTS = join(__dirname, "..");

  /** Writers whose weeks do not come from CFBD's merged feed, and why. */
  const EXEMPT: Record<string, string> = {
    "nfl-sync-games.ts": "NFL weeks come from ESPN's own calendar; the NFL has no week 0",
    "seed-fixtures.ts": "dev fixtures — invented games, invented weeks",
  };

  const files = [
    ...readdirSync(SCRIPTS).map((f) => ({ name: f, path: join(SCRIPTS, f) })),
    ...readdirSync(join(SCRIPTS, "lib")).map((f) => ({ name: f, path: join(SCRIPTS, "lib", f) })),
  ].filter((f) => f.name.endsWith(".ts") && !f.name.endsWith(".test.ts"));

  // `emit("games"` / `upsert("games"` / `from("games").upsert` — the three
  // shapes that put a row into that table today, matched across newlines
  // because the build's emit wraps its arguments.
  const WRITES_GAMES = /(?:emit|upsert)\(\s*"games"|from\("games"\)\s*\.upsert/;

  const writers = files.filter(({ path }) => WRITES_GAMES.test(readFileSync(path, "utf8")));

  it("finds the writers it is meant to be guarding", () => {
    // If this drops to nothing the regex has rotted and the suite below is
    // vacuously green — the failure mode a source scan is most prone to.
    const names = writers.map((w) => w.name);
    expect(names).toContain("sync-games.ts");
    expect(names).toContain("build-preseason.ts");
    expect(names).toContain("backfill.ts");
  });

  for (const { name, path } of writers) {
    const why = EXEMPT[name];
    it(why ? `${name} is exempt — ${why}` : `${name} routes week through resolvedWeek`, () => {
      const src = readFileSync(path, "utf8");
      if (why) return;
      expect(src, `${name} writes games but never calls resolvedWeek`).toMatch(/resolvedWeek\(/);
    });
  }
});

/**
 * How far back does CFBD actually go, per feed?
 *
 * `scripts/probe-cfbd.ts` answers "does this key's tier grant the endpoint",
 * probed against one completed season. That is an ACCESS question and the year
 * does not vary. This probe answers a different one: for each season in the
 * wide backtest window, does the feed contain enough rows to fit anything on?
 *
 * The two questions have different failure modes and the same symptom. A 403
 * means buy a tier; an empty 200 for 2015 means that season cannot be scored
 * by any tuner that reads the feed, forever — no amount of waiting fixes a
 * season CFBD never collected. Collapsing them is how you spend a month on the
 * wrong problem, which is why `classifyProbe` keeps DENIED and EMPTY apart and
 * why this reuses it rather than re-deriving it.
 *
 *   npx tsx scripts/probe-cfbd-history.ts            # print the table
 *   npx tsx scripts/probe-cfbd-history.ts --write    # ...and update the manifest
 *
 * Output is `scripts/lib/cfbd-coverage.json`, committed as a REVIEWED FACT so
 * `assertFeedCoverage` can refuse an under-covered window in CI without a key
 * and without spending a call.
 *
 * ## Cost
 *
 * 91 calls, one time: 12 seasons of SP+ (2014-2025 — 2014 is the bootstrap
 * prior for a 2015 start and is the single load-bearing row here), 11 each
 * of talent, returning production, advanced stats, week-1 Elo, week-8 Elo and
 * week-1 rankings, and 13 of recruiting classes (2013-2025 — classes reach
 * three years behind the first chained season). Week 8 stands in for
 * `--tune-ensemble`'s weeks 1-15; probing all 165 is not worth 165 calls to
 * learn what week 8 already says.
 *
 * That is 0.26% of a 30,000/month Tier 2 budget running at ~10,000. For scale,
 * `probe-cfbd.ts` is 17 calls and runs daily.
 *
 * ## What is deliberately NOT probed
 *
 * Games and lines. The archive backfill (BF-4, 2026-08-18) already pulled both
 * from CFBD for 2015-2025 and landed them in Supabase: 10,378 games, line
 * coverage 95-100% per season against a 55-70% guess. That question is
 * answered, it cost nothing to answer, and re-asking CFBD would be 22 calls to
 * reproduce a number already in docs/STATUS.md.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cfbd, cfbdCallCount, type CfbdRankingWeek } from "../src/lib/cfbd";
import { createServiceClient } from "../src/lib/supabase/service";
import { logCfbdCalls } from "./lib/jobs-core";
import { classifyProbe } from "./lib/probe";
import {
  FEED_FLOORS,
  coverageVerdict,
  type CoverageManifest,
  type CoverageRow,
  type FeedKey,
} from "./lib/coverage";

/** SP+ starts a season earlier than everything else: it seeds season N from N-1. */
const SP_FROM = 2014;
const FROM = 2015;
const TO = 2025;
/**
 * Recruiting classes reach back before everything else: `--tune-talent-source`
 * approximates the roster entering season N from the classes of N−3…N, and the
 * first chained season of a 2015-start window is 2016 — so 2013 is the oldest
 * class any tuner reads.
 */
const RECRUITING_FROM = 2013;

/**
 * `count` exists because array length is only a usable measure for the FLAT,
 * one-row-per-team payloads. The first real run of this probe reported
 * `rankings@wk1` as "thin" for all eleven seasons, which is the signature of a
 * broken measurement rather than a coverage gap — genuine gaps vary by year.
 * `/rankings` returns an array of WEEK objects, so a single-week query is
 * length 1 against a floor of 20, forever, in every season. The ranked teams
 * are nested two levels down at `polls[].ranks[]`.
 *
 * Left as a per-feed function rather than a special case, because the next
 * nested payload someone adds would repeat the bug silently: a feed now has to
 * say how it is counted, not just what floor it clears.
 */
const FEEDS: Array<{
  feed: FeedKey;
  from: number;
  call: (year: number) => Promise<unknown[]>;
  count?: (rows: unknown[]) => number;
}> = [
  { feed: "ratings/sp", from: SP_FROM, call: (y) => cfbd.spRatings(y) },
  { feed: "talent", from: FROM, call: (y) => cfbd.talent(y) },
  { feed: "player/returning", from: FROM, call: (y) => cfbd.returningProduction(y) },
  // Week 1 keeps the response small at the same one-call cost. The verdict
  // therefore describes WEEK 1, not the season — which is why 2020 reads thin
  // (a COVID-delayed opening weekend), not because the season lacks PPA.
  { feed: "stats/game/advanced", from: FROM, call: (y) => cfbd.advancedGameStats(y, { week: 1 }) },
  { feed: "ratings/elo@wk1", from: FROM, call: (y) => cfbd.eloRatings(y, 1) },
  { feed: "ratings/elo@weekly", from: FROM, call: (y) => cfbd.eloRatings(y, 8) },
  {
    feed: "rankings@wk1",
    from: FROM,
    call: (y) => cfbd.rankings(y, { week: 1 }),
    count: (rows) =>
      (rows as CfbdRankingWeek[]).reduce(
        (n, w) => n + (w.polls ?? []).reduce((m, p) => m + (p.ranks ?? []).length, 0),
        0,
      ),
  },
  // The composite's raw material and the `--tune-talent-source` substitute.
  // Counted as classes with a real points value: a row whose points are null
  // cannot feed the roster estimate, so counting it would overstate coverage.
  {
    feed: "recruiting/teams",
    from: RECRUITING_FROM,
    call: (y) => cfbd.recruitingTeams(y),
    count: (rows) =>
      (rows as Array<{ points: number | null }>).filter((r) => r.points !== null).length,
  },
];

/**
 * Fixed-width season x feed grid, so a re-probe diffs cleanly against the last
 * one — the same discipline `formatProbe` follows for the access table.
 */
export function coverageGrid(rows: readonly CoverageRow[], seasons: readonly number[]): string {
  const feeds = [...new Set(rows.map((r) => r.feed))];
  const mark = (v: string) =>
    v === "OK" ? "  ok " : v === "THIN" ? "thin " : v === "EMPTY" ? "  -- " : v === "DENIED" ? " DEN " : " ERR ";
  const lines = [
    `feed                    ${seasons.map((s) => String(s).slice(2).padStart(5)).join("")}`,
    "-".repeat(24 + seasons.length * 5),
  ];
  for (const feed of feeds) {
    const cells = seasons
      .map((s) => {
        const row = rows.find((r) => r.season === s && r.feed === feed);
        return row ? mark(row.verdict) : "     ";
      })
      .join("");
    lines.push(`${feed.padEnd(24)}${cells}`);
  }
  lines.push("");
  lines.push("ok = usable   thin = present but below the join floor   -- = empty   DEN/ERR = access");
  return lines.join("\n");
}

async function main() {
  const write = process.argv.includes("--write");
  const earliest = Math.min(...FEEDS.map((f) => f.from));
  const seasons = Array.from({ length: TO - earliest + 1 }, (_, i) => earliest + i);
  const rows: CoverageRow[] = [];

  console.log(`Probing CFBD history ${SP_FROM}-${TO} across ${FEEDS.length} feeds…\n`);

  for (const { feed, from, call, count } of FEEDS) {
    for (let year = from; year <= TO; year++) {
      let outcome: { rows: number } | { error: unknown };
      try {
        const rows = await call(year);
        outcome = { rows: count ? count(rows) : rows.length };
      } catch (error) {
        outcome = { error };
      }
      const classified = classifyProbe(outcome);
      rows.push({
        season: year,
        feed,
        verdict: coverageVerdict(
          { status: classified.status, rows: classified.rows },
          FEED_FLOORS[feed],
        ),
        rows: classified.rows,
      });
    }
  }

  console.log(coverageGrid(rows, seasons));

  // The one row the whole widening rests on. A 2015 start seeds its priors
  // from 2014 SP+; without it the window starts wherever SP+ does.
  const sp2014 = rows.find((r) => r.season === SP_FROM && r.feed === "ratings/sp");
  console.log(
    `\nBootstrap prior: /ratings/sp ${SP_FROM} is ${sp2014?.verdict ?? "UNPROBED"} ` +
      `(${sp2014?.rows ?? "–"} rows). ` +
      (sp2014?.verdict === "OK"
        ? `A ${FROM} start is seedable.`
        : `A ${FROM} start is NOT seedable — the window starts at the earliest season whose ` +
          `PREDECESSOR has SP+.`),
  );

  for (const feed of new Set(rows.map((r) => r.feed))) {
    const bad = rows.filter((r) => r.feed === feed && r.verdict !== "OK").map((r) => r.season);
    if (bad.length > 0) {
      console.log(
        `::warning::${feed} is unusable for ${bad.join(", ")} — every tuner that reads it must ` +
          `either narrow its window or record those seasons as permanently out of scope.`,
      );
    }
  }

  if (write) {
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "lib",
      "cfbd-coverage.json",
    );
    const manifest: CoverageManifest = {
      // Probe results are the date they were taken; a manifest that cannot say
      // when it was true is a manifest nobody can age out.
      probedAt: new Date().toISOString().slice(0, 10),
      note:
        `Per-season CFBD auxiliary-feed coverage, ${SP_FROM}-${TO}. Produced by ` +
        `scripts/probe-cfbd-history.ts (npm run probe:history) and committed as a reviewed ` +
        `fact so scripts/lib/coverage.ts can refuse an under-covered window without spending ` +
        `a CFBD call. Games and lines are deliberately absent — BF-4 verified those from ` +
        `Supabase at zero CFBD cost.`,
      rows,
    };
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\nWrote ${rows.length} rows to ${file}. Commit it — CI reads it without a key.`);
  } else {
    console.log("\n(--write not passed; manifest unchanged.)");
  }

  // Meter it, like probe-cfbd does. Runs fine with only a CFBD key.
  try {
    await logCfbdCalls(createServiceClient(), "cfbd-history-probe", cfbdCallCount());
  } catch {
    /* the meter is a bonus, not a dependency */
  }
  console.log(`${cfbdCallCount()} CFBD calls spent.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

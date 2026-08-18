/**
 * 2026 preseason build (docs/SPEC.md §2.1): computes preseason ratings for
 * every FBS team and emits chunked JSON row files for loading into Supabase
 * (via PostgREST or the admin-load edge function).
 *
 * Rating = 0.70×final_2025 (from the tuned replay chain over 2023–2025)
 *        + 0.30×talent_baseline
 *        + churn (returning production, QB proxy, portal stars)
 *        + coaching (CFBD /coaches: new-HC detection × the incoming coach's
 *          historical over-performance; zero for everyone until the tuner
 *          fits newHcIntercept/newHcSlope — see scripts/lib/coaching.ts)
 *        + luck (2025 actual vs second-order wins + one-score record)
 *
 * Also emits: teams, venues, 2026 games, week-1 line snapshots, team HFA
 * (2015–2024 quick estimate), week-0 ratings, preseason components, and
 * frozen week-1 predictions.
 *
 * Those week-1 predictions are a FALLBACK receipt: the Thursday freeze job
 * re-prices the same slate against live lines and real system-consensus
 * inputs, and since predictions is append-only and read latest-first, the
 * freeze batch supersedes this one on its own. Both are kept on purpose.
 *
 * Output: files named NN-<table>-<chunk>.json in --out (default .preseason-json/),
 * each a plain JSON array of row objects for that table, load in filename order.
 * Data-quality proxies (v1, noted in detail JSON): OL share=0.5 (no data),
 * turnover margin=0 (not pulled).
 *
 * Usage: npx tsx scripts/build-preseason.ts [--out DIR] [--top N]
 *        npx tsx scripts/build-preseason.ts --check    # readiness only, no files
 *        npx tsx scripts/build-preseason.ts --check --force   # accept the fallbacks
 *
 * `--force` is the Q1 escape hatch (docs/STATUS.md §3): it makes `--check`
 * report every problem and still exit 0, so a deliberate build on last year's
 * talent can ship rather than the season opening on a rating four versions
 * behind. It changes nothing about the numbers — the build already falls back
 * — it changes only whether the gate stops the load. What ships is recorded:
 * every `preseason_components.detail` carries `talent_source` and
 * `talent_stale`, and `/model` reads them, so a forced build announces itself
 * in the product instead of living in a workflow log.
 *
 * **Not the same flag as `load-preseason.ts --force`**, which overrides a
 * different guard (loading over a season that has already played games). One
 * means "the inputs are incomplete and I know", the other means "the season
 * has started and I know".
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cfbd, cfbdCallCount, type CfbdGame } from "../src/lib/cfbd";
import {
  DEFAULT_PARAMS,
  MODEL_VERSION,
  churnAdjustment,
  clamp,
  centeredBlendedHfa,
  coachingAdjustmentContinuous,
  luckCorrection,
  paramsForWeek,
  preseasonRating,
  priceGame,
  splitInformative,
  type TeamRating,
} from "../src/model/ratings";
import { createServiceClient } from "../src/lib/supabase/service";
import { buildCoachTransitions } from "./lib/coaching";
import { logCfbdCalls } from "./lib/jobs-core";
import { envNum } from "./lib/env-num";
import { fcsMarginsVsFbs, fcsRatingOf, fcsTopIds } from "../src/model/fcs";
import { portalPoints, portalScale } from "./lib/portal";
import {
  cached,
  chainPriors,
  chainTilts,
  consensusLine,
  loadSeason,
  priorsFromSp,
  replaySeason,
  teamIdsByNameFrom,
} from "./lib/replay";
import { tierOf } from "./lib/tiers";

// Env-driven like the rest of the pipeline (scripts/lib/ingest reads the same
// var): the loader validates its dir against CFB_SEASON, so a hardcode here
// meant a 2027 build silently carried 2026 data past a loader guard checking
// the wrong year (audit 04/DQ-14).
const SEASON = envNum("CFB_SEASON", 2026, { min: 2000, max: 2100 });
const REPLAY_SEASONS = [2023, 2024, 2025];
const CHUNK = 250;

/**
 * How much off/def SHAPE carries from the previous season into the preseason
 * halves. 0 = even split, which makes every week-0/1 projected total the same
 * constant (exactly 57.0 at tempo 70) and forces totals to be withheld.
 *
 * 0.4 is the fitted value from `backtest.ts --tune-preseason-tilts`, which
 * cleared its pre-registered rule on both arms: weeks 1–2 totals MAE 13.34 vs
 * 13.72 for no tilt (rule needed ≥0.15), and weeks 1–4 also improved, 12.93 vs
 * 13.16. Every SP+-shape variant lost badly (up to 16.87) — the earlier sweep
 * that "ruled out tilts" only ever tested SP+ shape, never carryover.
 */
// A typo'd env var used to coerce to NaN and silently disable the tilt
// (falsy), shipping withheld totals with no explanation (audit 04/DQ-13). That
// fix caught NaN and missed the emptier case: `PRESEASON_TILT_CARRY=""` is not
// `undefined`, `Number("")` is `0`, and `0` is not NaN — so a blank env var
// took the "even split" branch and disabled the fitted parameter in exactly
// the silence the guard was written to prevent (P2-1). `envNum` treats blank
// as unset and still throws on garbage.
const TILT_CARRY = envNum("PRESEASON_TILT_CARRY", 0.4, { min: 0, max: 1 });

type Row = Record<string, string | number | boolean | null | object>;

async function main() {
  const outArg = process.argv.indexOf("--out");
  const outDir = outArg > -1 ? process.argv[outArg + 1] : ".preseason-json";
  const force = process.argv.includes("--force");
  await mkdir(outDir, { recursive: true });
  let fileNo = 0;

  async function emit(table: string, rows: Row[]) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunkRows = rows.slice(i, i + CHUNK);
      const file = path.join(
        outDir,
        `${String(++fileNo).padStart(2, "0")}-${table}-${i / CHUNK}.json`,
      );
      await writeFile(file, JSON.stringify(chunkRows));
      console.log(`  wrote ${file} (${chunkRows.length} rows)`);
    }
  }

  // ---- 1. Replay 2023–2025 with tuned params → final 2025 ratings ----------
  console.log("Replaying 2023–2025 for final ratings…");
  const seasons = [];
  for (const s of REPLAY_SEASONS) seasons.push(await loadSeason(s, true));
  const idsByName = teamIdsByNameFrom(seasons);

  let priors = priorsFromSp(seasons[0].prevSp, idsByName);
  let tilts: Map<number, number> | undefined;
  let replayFinals = new Map<number, number>();
  let replayTilts = new Map<number, number>();
  for (const season of seasons) {
    const { finalRatings, finalTilts } = replaySeason(season, priors, DEFAULT_PARAMS, tilts);
    replayFinals = finalRatings;
    replayTilts = finalTilts;
    priors = chainPriors(finalRatings);
    // Shape carries only when the tuner has earned it; at 0 this is the even
    // split production has always shipped.
    tilts = TILT_CARRY ? chainTilts(finalTilts, TILT_CARRY) : undefined;
  }

  // Prior-year baseline: 50/50 our replay and final SP+ (--tune-sp-blend).
  // SP+'s opponent adjustment corrects G5 schedule-pocket inflation that a
  // pure margin replay can't see.
  const REPLAY_SHARE = 0.5;
  const sp2025Rows = await cached("sp-2025", () => cfbd.spRatings(2025), true);
  const sp2025 = priorsFromSp(sp2025Rows, idsByName);
  const finals = new Map<number, number>();
  for (const [teamId, replayRating] of replayFinals) {
    const sp = sp2025.get(teamId);
    finals.set(
      teamId,
      sp !== undefined ? REPLAY_SHARE * replayRating + (1 - REPLAY_SHARE) * sp : replayRating,
    );
  }
  console.log(`  ${finals.size} teams have 2025 final ratings (${sp2025.size} with SP+)`);

  // ---- 2. Fetch 2026 data ---------------------------------------------------
  console.log("Fetching 2026 reference data…");
  const [teams, venues, games2026, lines2026, returning, portal] = await Promise.all([
    cached(`teams-${SEASON}`, () => cfbd.teams(SEASON), true),
    cached("venues", () => cfbd.venues(), true),
    cached(`games-${SEASON}`, () => cfbd.games(SEASON), true),
    cached(`lines-${SEASON}`, () => cfbd.lines(SEASON), true),
    cached(`returning-${SEASON}`, () => cfbd.returningProduction(SEASON), true),
    cached(`portal-${SEASON}`, () => cfbd.portal(SEASON), true),
  ]);
  // Coaching histories: one call covers every school-season we need for both
  // change detection and the incoming coach's track record.
  const coachRows = await cached(
    `coaches-${SEASON}`,
    () => cfbd.coaches({ minYear: 2001, maxYear: SEASON }),
    true,
  );
  const transitions = buildCoachTransitions(coachRows, SEASON);

  let talent = await cached(`talent-${SEASON}`, () => cfbd.talent(SEASON), true);
  let talentIsStale = false;
  if (talent.length === 0) {
    console.log(`  no ${SEASON} talent yet — falling back to ${SEASON - 1}`);
    talentIsStale = true;
    talent = await cached(`talent-${SEASON - 1}`, () => cfbd.talent(SEASON - 1), true);
  }

  const fbs = teams.filter((t) => t.classification === "fbs");
  const teamByName = new Map(teams.map((t) => [t.school, t]));

  // FCS buckets (SPEC §2.1, P1-2). Production cannot compute this at runtime —
  // the database holds only the current season — so it is computed here, where
  // 2023–25 is already in memory, and materialised on teams.fcs_avg_margin
  // (0035) for freezeJob and ratingsUpdateJob to read back.
  //
  // `before: SEASON` is what keeps it honest: only seasons strictly before the
  // one being built, the same rule the replay's lookahead guard enforces.
  const fcsMargins = fcsMarginsVsFbs(
    seasons.flatMap((s) => s.games),
    new Set(fbs.map((t) => t.id)),
    { before: SEASON },
  );
  const fcsTop = fcsTopIds(fcsMargins);
  console.log(
    `  FCS buckets: ${fcsTop.size} top / ${fcsMargins.size - fcsTop.size} other ` +
      `of ${fcsMargins.size} rated, from ${REPLAY_SEASONS.join("–")} margins vs FBS ` +
      `(inert: both params are ${DEFAULT_PARAMS.fcsTopRating})`,
  );

  // ---- 3. Talent baseline (points scale) ------------------------------------
  const talentVals = talent.map((t) => t.talent);
  const tMean = talentVals.reduce((a, b) => a + b, 0) / talentVals.length;
  const tStd = Math.sqrt(talentVals.reduce((a, b) => a + (b - tMean) ** 2, 0) / talentVals.length);
  const talentBaseline = new Map<number, number>();
  for (const t of talent) {
    const team = teamByName.get(t.team);
    if (team) talentBaseline.set(team.id, clamp(((t.talent - tMean) / tStd) * 5.5, -18, 18));
  }
  // Fallback for teams the talent file misses: their conference's mean, then
  // −8 only when a whole conference is absent. The flat −8 was a mid-table
  // gift to FCS call-ups (Sacramento State ranked 94th of 138 on it — audit
  // 04/DQ-3) and an over-tax on a P4 team dropped by a rename: unknown-talent
  // teams should price like their peers, not like one hardcoded guess.
  const confTalent = new Map<string, { sum: number; n: number }>();
  for (const team of fbs) {
    const v = talentBaseline.get(team.id);
    if (v === undefined || !team.conference) continue;
    const c = confTalent.get(team.conference) ?? { sum: 0, n: 0 };
    confTalent.set(team.conference, { sum: c.sum + v, n: c.n + 1 });
  }
  const talentFor = (team: { id: number; conference: string | null }): number => {
    const own = talentBaseline.get(team.id);
    if (own !== undefined) return own;
    const c = team.conference ? confTalent.get(team.conference) : undefined;
    return c && c.n > 0 ? c.sum / c.n : -8;
  };

  // ---- 4. Churn inputs ------------------------------------------------------
  const returningByTeam = new Map(returning.map((r) => [r.team, r]));
  const portalNet = new Map<number, number>();
  for (const p of portal) {
    const stars = p.stars ?? 2;
    if (p.destination) {
      const t = teamByName.get(p.destination);
      if (t) portalNet.set(t.id, (portalNet.get(t.id) ?? 0) + stars);
    }
    if (p.origin) {
      const t = teamByName.get(p.origin);
      if (t) portalNet.set(t.id, (portalNet.get(t.id) ?? 0) - stars);
    }
  }
  // Standardize over the FBS teams the adjustment is applied to, centred on
  // their mean — see scripts/lib/portal.ts for what each half of that fixes and
  // for the headcount problem it deliberately does NOT fix.
  const pScale = portalScale(
    fbs.map((t) => t.id),
    portalNet,
  );

  // ---- 5. Luck inputs from 2025 results ------------------------------------
  const games2025 = seasons[2].games;
  interface LuckAgg {
    wins: number;
    soWins: number;
    oneScoreW: number;
    oneScoreL: number;
  }
  const luck = new Map<number, LuckAgg>();
  const luckFor = (id: number): LuckAgg => {
    let l = luck.get(id);
    if (!l) {
      l = { wins: 0, soWins: 0, oneScoreW: 0, oneScoreL: 0 };
      luck.set(id, l);
    }
    return l;
  };
  for (const g of games2025) {
    if (g.homePoints === null || g.awayPoints === null) continue;
    const margin = g.homePoints - g.awayPoints;
    const pHome = g.homePostgameWinProbability;
    const h = luckFor(g.homeId);
    const a = luckFor(g.awayId);
    if (margin > 0) h.wins++;
    else if (margin < 0) a.wins++;
    if (pHome !== null) {
      h.soWins += pHome;
      a.soWins += 1 - pHome;
    } else {
      h.soWins += margin > 0 ? 1 : 0;
      a.soWins += margin < 0 ? 1 : 0;
    }
    if (Math.abs(margin) <= 8) {
      if (margin > 0) {
        h.oneScoreW++;
        a.oneScoreL++;
      } else if (margin < 0) {
        a.oneScoreW++;
        h.oneScoreL++;
      }
    }
  }

  // ---- 6. Preseason rating per FBS team -------------------------------------
  console.log("Computing preseason ratings…");
  interface Preseason {
    teamId: number;
    rating: number;
    finalPrev: number | null;
    talent: number;
    churn: number;
    coaching: number;
    coach: string | null;
    overPerf: number | null;
    luckCorr: number;
    retOff: number | null;
    /** CFBD's `usage` — an offensive usage share. See 04:DQ-5 / migration 0041. */
    retUsage: number | null;
  }
  const preseason: Preseason[] = [];
  const missingCoachData: string[] = [];
  for (const team of fbs) {
    const finalPrev = finals.get(team.id) ?? null;
    const tal = talentFor(team);
    const ret = returningByTeam.get(team.school);
    const retPassing = ret?.percentPassingPPA ?? null;
    const retOverall = ret?.percentPPA ?? null;

    const churn = churnAdjustment(
      {
        // One returning-production term. `usage` used to be passed as a
        // "defense" value, but it is another offense metric — that double-count
        // is what pinned Alabama, Penn State and Auburn at the −6 clamp.
        returningProduction: retOverall ?? 0.6,
        qbReturns: ret && retPassing !== null ? retPassing >= 0.5 : null,
        olReturningShare: 0.5, // no data source — neutral (docs/SPEC.md §3 v2)
        netPortalPoints: portalPoints(portalNet.get(team.id) ?? 0, pScale),
        blueChipFreshmen: 0,
        talentBaseline: tal,
      },
      DEFAULT_PARAMS,
    );

    const l = luck.get(team.id);
    const luckCorr = l
      ? luckCorrection({
          actualWins: l.wins,
          secondOrderWins: l.soWins,
          turnoverMargin: 0, // not pulled in v1
          oneScoreWins: l.oneScoreW,
          oneScoreLosses: l.oneScoreL,
        })
      : 0;

    // Coaching: a real signal now, but zero for everyone until the tuner fits
    // newHcIntercept/newHcSlope. A school CFBD has no 2026 row for is treated
    // as intact and reported, never guessed at.
    const transition = transitions.get(team.school);
    if (!transition || transition.coach === null) missingCoachData.push(team.school);
    const coaching = coachingAdjustmentContinuous(
      {
        newHc: transition?.newHc ?? false,
        overPerf: transition?.overPerf ?? null,
      },
      DEFAULT_PARAMS,
    );

    const rating = preseasonRating({
      finalPrevRating: finalPrev,
      talentBaseline: tal,
      churnAdjustment: churn,
      coachingAdjustment: coaching,
      luckCorrection: luckCorr,
    });

    preseason.push({
      teamId: team.id,
      rating,
      finalPrev,
      talent: tal,
      churn,
      coaching,
      coach: transition?.newHc ? transition.coach : null,
      overPerf: transition?.newHc ? transition.overPerf : null,
      luckCorr,
      retOff: retOverall,
      retUsage: ret?.usage ?? null,
    });
  }
  // ---- 6½. Tier recentre — market-anchored (fitted rule: --tune-tier-recenter)
  //
  // A margin-Elo's intra-pool games are zero-sum within the pool, so the P4/G5
  // LEVEL is set almost entirely by the prior, and every regression in the
  // chain (0.7× toward zero between replay seasons, 0.3 toward a talent
  // baseline whose P4−G5 separation is ~half the market's) shrinks the pool
  // gap that the replay finals carry. The ~1.5 cross-tier games per team per
  // season restore it at only K/2·error per game — measured, a week-1
  // mis-level decays to ~0 only by week 9. Unpatched, the 2026 build priced
  // every P4-vs-G5 opener ~10 points toward the G5 (mean +10.4, t = 7.8 vs
  // the week-1 market; Toledo a double-digit road favourite at Michigan State).
  //
  // The patch: shift the two pools (zero-sum, membership-weighted — within-
  // pool ordering untouched) so the mean G5-signed cross-tier edge against
  // the week-1 consensus lines is zero. Week-1 lines exist before week 1, so
  // this is point-in-time sound. Anchoring to the market each August rather
  // than a fitted constant is deliberate: the fit was +4.4 (2024) and +4.7
  // (2025) but +10.4 (2026) — the offseason P4/G5 divergence is accelerating
  // and a constant fit on 2023–25 under-corrects the present.
  //
  // Validated by `backtest.ts --tune-tier-recenter` (pre-registered rule, all
  // four criteria passed): weeks 2–4 cross-tier edge +5.41 → +0.78 (out-of-
  // fit), weeks 1–4 bias vs actual −6.31 (t −4.7) → −1.57 (t −1.2), P4vP4
  // unmoved (+0.51), pooled MAE 13.22 → 13.14, NLL 0.4994 → 0.4956.
  //
  // The fit prices with flat baseHfa — the exact configuration the tuner
  // validated; the team-HFA blend's mean is pinned to baseHfa, so the
  // difference is tenths. FCS opponents stay at the flat −30, which was
  // implicitly calibrated against the OLD G5 level; September FCS games will
  // pull the pools back together by ~1–1.5 points through the Elo (each G5
  // team's FCS buy game now under-predicts it) — a known, bounded decay,
  // watched by the FBS-vs-FCS row of the backtest's slice table.
  const tierById = new Map(
    fbs.map((t) => [t.id, tierOf(t.conference, t.school, SEASON, true)] as const),
  );
  let tierRecenter: { shift: number; p4: number; g5: number; n: number } | null = null;
  {
    const ratingById = new Map(preseason.map((p) => [p.teamId, p.rating]));
    const linesByGame = new Map(lines2026.map((l) => [l.id, l]));
    const edges: number[] = [];
    for (const g of games2026 as CfbdGame[]) {
      if (g.week !== 1 || g.seasonType !== "regular") continue;
      const vegas = consensusLine(linesByGame.get(g.id));
      if (vegas === null) continue;
      const hr = ratingById.get(g.homeId);
      const ar = ratingById.get(g.awayId);
      if (hr === undefined || ar === undefined) continue;
      const ht = tierById.get(g.homeId);
      const at = tierById.get(g.awayId);
      const cross = (ht === "P4" && at === "G5") || (ht === "G5" && at === "P4");
      if (!cross) continue;
      const margin = hr - ar + (g.neutralSite ? 0 : DEFAULT_PARAMS.baseHfa);
      const edge = -margin - vegas; // + = we favour the away side vs market
      edges.push(at === "G5" ? edge : -edge);
    }
    if (edges.length < 10) {
      console.log(
        `  WARNING: tier recentre SKIPPED — only ${edges.length} cross-tier week-1 games with lines ` +
          `(need 10). The cross-classification level is unpatched in this build.`,
      );
    } else {
      const shift = edges.reduce((a, b) => a + b, 0) / edges.length;
      if (Math.abs(shift) > 15) {
        throw new Error(
          `tier recentre fit ${shift.toFixed(2)} exceeds the ±15 sanity bound — ` +
            `the lines feed or the ratings are broken; refusing to ship either`,
        );
      }
      const nP4 = fbs.filter((t) => tierById.get(t.id) === "P4").length;
      const nG5 = fbs.filter((t) => tierById.get(t.id) === "G5").length;
      const p4Shift = (shift * nG5) / (nP4 + nG5);
      const g5Shift = (-shift * nP4) / (nP4 + nG5);
      for (const p of preseason) {
        const tier = tierById.get(p.teamId);
        p.rating += tier === "P4" ? p4Shift : tier === "G5" ? g5Shift : 0;
      }
      console.log(
        `  tier recentre: week-1 cross-tier lean vs market ${shift >= 0 ? "+" : ""}${shift.toFixed(2)} ` +
          `on n=${edges.length} → P4 ${p4Shift >= 0 ? "+" : ""}${p4Shift.toFixed(2)}, ` +
          `G5 ${g5Shift >= 0 ? "+" : ""}${g5Shift.toFixed(2)} (zero-sum)`,
      );
      tierRecenter = { shift, p4: p4Shift, g5: g5Shift, n: edges.length };
    }
  }

  const newHires = preseason.filter((p) => p.coach !== null).length;
  console.log(
    `  coaching: ${newHires} new head coaches detected` +
      `${DEFAULT_PARAMS.newHcIntercept === 0 && DEFAULT_PARAMS.newHcSlope === 0 ? " (adjustment 0 — tuner has not fit newHc params yet)" : ""}`,
  );
  if (missingCoachData.length > 0) {
    console.log(
      `  WARNING: no ${SEASON} coach row for ${missingCoachData.length} team(s), treated as intact: ` +
        missingCoachData.slice(0, 10).join(", ") +
        (missingCoachData.length > 10 ? ", …" : ""),
    );
  }
  preseason.sort((a, b) => b.rating - a.rating);

  // Ranking table with the component breakdown. The backtest validates the
  // model against 2023–25; only an eyeball against a real preseason poll
  // catches a 2026-specific data failure (a talent join that silently missed,
  // a returning-production name mismatch), because a broken input still
  // produces a confident-looking number.
  const topArg = process.argv.indexOf("--top");
  const topN = topArg > -1 ? Number(process.argv[topArg + 1]) : 25;
  const schoolOf = new Map(fbs.map((t) => [t.id, t.school]));
  console.log(`\n  === ${SEASON} preseason ratings, top ${topN} ===`);
  console.log("  rk  team                     rating   prev  talent  churn  coach   luck");
  for (const [i, p] of preseason.slice(0, topN).entries()) {
    console.log(
      `  ${String(i + 1).padStart(2)}  ${(schoolOf.get(p.teamId) ?? "?").padEnd(24)} ` +
        `${p.rating.toFixed(1).padStart(6)}  ${(p.finalPrev ?? 0).toFixed(1).padStart(5)}  ` +
        `${p.talent.toFixed(1).padStart(6)}  ${p.churn.toFixed(1).padStart(5)}  ` +
        `${p.coaching.toFixed(1).padStart(5)}  ${p.luckCorr.toFixed(1).padStart(5)}`,
    );
  }
  const ratingVals = preseason.map((p) => p.rating);
  console.log(
    `  ${preseason.length} FBS teams | range ${Math.min(...ratingVals).toFixed(1)} to ` +
      `${Math.max(...ratingVals).toFixed(1)} | median ` +
      `${ratingVals.slice().sort((a, b) => a - b)[Math.floor(ratingVals.length / 2)].toFixed(1)}`,
  );
  // Inputs that silently defaulted are the failure mode worth naming out loud.
  // --check: readiness gate. CFBD publishes preseason inputs on its own
  // schedule, and a missing one does not error — it silently falls back and
  // produces a confident-looking rating. This says plainly whether the data is
  // complete enough to do the real build, and exits non-zero when it isn't so
  // a scheduled run is visible rather than quietly green.
  if (process.argv.includes("--check")) {
    const problems: string[] = [];
    if (talentIsStale) {
      problems.push(`talent: ${SEASON} not published, using ${SEASON - 1} (no incoming class)`);
    }
    // A partially published talent file passes the staleness check above while
    // every unmatched team silently takes the −8 constant — the 2026.2.0 bug
    // class at partial scale, feeding an unattended daily auto-load.
    const talentDefaults = fbs.filter((t) => !talentBaseline.has(t.id)).length;
    if (talentDefaults > 5) {
      problems.push(
        `talent: ${talentDefaults} FBS teams unmatched — each takes its conference-mean fallback`,
      );
    }
    const missingRet = preseason.filter((p) => p.retOff === null).length;
    if (missingRet > 5) problems.push(`returning production: ${missingRet} teams unmatched`);
    // A partially-published coach feed matched SOME hires: a low-but-nonzero
    // count is likelier a half-loaded feed than a quiet coaching carousel, so
    // gate on a floor rather than only on zero (audit 04/§2).
    if (newHires < 8) {
      problems.push(`coaches: only ${newHires} head-coach changes detected — feed may be partial`);
    }
    if (portal.length === 0) problems.push("portal: no transfer entries — feed not published yet");
    if (lines2026.length === 0) problems.push("lines: no week-1 lines posted yet");
    if (!tierRecenter) {
      problems.push(
        "tier recentre: fewer than 10 cross-tier week-1 games with lines — the P4/G5 level would ship unpatched",
      );
    }
    const clampedNow = preseason.filter((p) => Math.abs(Math.abs(p.churn) - 6) < 0.001).length;
    if (clampedNow > 15) problems.push(`churn: ${clampedNow} teams at the ±6 clamp`);

    console.log(`\n=== preseason readiness for ${SEASON} ===`);
    if (problems.length === 0) {
      console.log("READY — every input is live. Safe to run the real build and load.");
      // --force with nothing to force is not an error, but saying so out loud
      // beats leaving somebody to wonder whether the flag did anything.
      if (force) console.log("  (--force passed and not needed — every input is live.)");
      return;
    }
    for (const p of problems) console.log(`  NOT READY — ${p}`);
    if (force) {
      // The gate still reports everything it found: a forced build is a
      // decision to ship a known-degraded rating, and the decision is only
      // informed if the list survives the override. Exit 0 so the caller
      // proceeds — see jobs.yml's preseason-force task.
      console.log(
        `\nFORCED — ${problems.length} problem(s) above, proceeding anyway (--force).\n` +
          `  This ships a rating built on the fallbacks listed above. At talentWeight ` +
          `${DEFAULT_PARAMS.talentWeight} a missing incoming class is a ±1–2 pt error per team; ` +
          `the version it replaces is wrong about home field on every game.\n` +
          `  What ships is recorded: preseason_components.detail carries talent_source and ` +
          `talent_stale, and /model renders the note. Re-run without --force once CFBD ` +
          `publishes and the note clears itself.`,
      );
      return;
    }
    console.log(
      "\nRe-run once CFBD publishes. Loading now ships a rating built on a fallback.",
    );
    process.exitCode = 1;
    return;
  }

  const noPrev = preseason.filter((p) => p.finalPrev === null).length;
  const noRet = preseason.filter((p) => p.retOff === null).length;
  const noTalent = fbs.filter((t) => !talentBaseline.has(t.id)).length;
  if (noPrev > 0) console.log(`  note: ${noPrev} team(s) had no prior-season rating (talent only)`);
  if (noRet > 0) console.log(`  note: ${noRet} team(s) had no returning-production match`);
  if (noTalent > 0)
    console.log(`  note: ${noTalent} team(s) had no talent match — each took its conference-mean fallback`);
  // A clamp that binds often isn't protecting against outliers, it's erasing
  // real differences — the model stops being able to tell "bad" from "awful".
  const clamped = preseason.filter((p) => Math.abs(Math.abs(p.churn) - 6) < 0.001).length;
  if (clamped > 0) {
    console.log(
      `  note: ${clamped} team(s) hit the ±6 churn clamp` +
        (clamped > 5 ? " — saturating; the churn scale is too hot" : ""),
    );
  }

  // ---- 7. Team HFA quick estimate (2015–2024) -------------------------------
  console.log("Estimating team HFA from 2015–2024…");
  const fbsIds = new Set(fbs.map((t) => t.id));
  const homeMargins = new Map<number, number[]>();
  const awayMargins = new Map<number, number[]>();
  for (let year = 2015; year <= 2024; year++) {
    const games = await cached(`games-${year}`, () => cfbd.games(year), true);
    for (const g of games) {
      if (g.homePoints === null || g.awayPoints === null || g.neutralSite) continue;
      // FBS-vs-FBS only (approximated by 2026 membership): home slates carry
      // the FCS buy games, so raw home averages were inflated ~+2 points by
      // scheduling rather than home field — SPEC §2.3 asks for residuals, and
      // this is the same-source version of that fix (audit 03/M-1b). The
      // centered blend on top pins the mean; this repairs the per-team spread.
      if (!fbsIds.has(g.homeId) || !fbsIds.has(g.awayId)) continue;
      const margin = g.homePoints - g.awayPoints;
      if (!homeMargins.has(g.homeId)) homeMargins.set(g.homeId, []);
      homeMargins.get(g.homeId)!.push(margin);
      if (!awayMargins.has(g.awayId)) awayMargins.set(g.awayId, []);
      awayMargins.get(g.awayId)!.push(-margin);
    }
  }
  const avg = (xs: number[] | undefined) =>
    xs && xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  // ---- 8. Emit --------------------------------------------------------------
  console.log("Emitting JSON…");
  const r2 = (x: number) => Math.round(x * 100) / 100;

  await emit("seasons", [
    { id: SEASON, label: String(SEASON), week0_start: "2026-08-29", is_current: true },
  ]);

  const gameTeamIds = new Set(games2026.flatMap((g) => [g.homeId, g.awayId]));
  const known = new Set(teams.map((t) => t.id));
  const nameById = new Map<number, string>();
  for (const g of games2026) {
    nameById.set(g.homeId, g.homeTeam);
    nameById.set(g.awayId, g.awayTeam);
  }
  const teamRows: Row[] = teams
    .filter((t) => t.classification === "fbs" || t.classification === "fcs" || gameTeamIds.has(t.id))
    .map((t) => ({
      id: t.id,
      school: t.school,
      mascot: t.mascot,
      abbreviation: t.abbreviation,
      conference: t.conference,
      classification: t.classification ?? "fbs",
      color: t.color,
      alt_color: t.alternateColor,
      logo_url: t.logos?.[0] ?? null,
      // Null for every FBS team and for any FCS team with too few games —
      // loadFcsTop reads only non-null rows, so absence is the safe default.
      fcs_avg_margin: fcsMargins.get(t.id)?.avgMargin ?? null,
    }));
  for (const id of gameTeamIds) {
    if (!known.has(id)) {
      teamRows.push({ id, school: nameById.get(id) ?? `Team ${id}`, classification: "other" });
    }
  }
  await emit("teams", teamRows);

  await emit(
    "venues",
    venues.map((v) => ({
      id: v.id,
      name: v.name,
      city: v.city,
      state: v.state,
      latitude: v.latitude,
      longitude: v.longitude,
      capacity: v.capacity,
      dome: v.dome ?? false,
      timezone: v.timezone,
    })),
  );

  const venueIds = new Set(venues.map((v) => v.id));
  await emit(
    "games",
    games2026.map((g) => ({
      id: g.id,
      season_id: SEASON,
      week: g.week,
      season_type: g.seasonType,
      start_ts: g.startDate,
      start_time_tbd: g.startTimeTBD,
      neutral_site: g.neutralSite,
      conference_game: g.conferenceGame,
      venue_id: g.venueId !== null && venueIds.has(g.venueId) ? g.venueId : null,
      home_team_id: g.homeId,
      away_team_id: g.awayId,
      home_points: g.homePoints,
      away_points: g.awayPoints,
      status: g.completed ? "final" : "scheduled",
      notes: g.notes,
    })),
  );

  const gameIds2026 = new Set(games2026.map((g) => g.id));
  await emit(
    "line_snapshots",
    lines2026
      .filter((l) => gameIds2026.has(l.id))
      .flatMap((game) =>
        game.lines.map((l) => ({
          game_id: game.id,
          provider: l.provider,
          source: "cfbd",
          spread: l.spread,
          spread_open: l.spreadOpen,
          total: l.overUnder,
          total_open: l.overUnderOpen,
          ml_home: l.homeMoneyline,
          ml_away: l.awayMoneyline,
        })),
      ),
  );

  const hfaRows: Row[] = [];
  const hfaById = new Map<number, number>();
  const rawHfaById = new Map<number, number | null>();
  for (const team of fbs) {
    const h = avg(homeMargins.get(team.id));
    const a = avg(awayMargins.get(team.id));
    // (home avg − away avg)/2: team strength cancels to first order —
    // opponent strength does NOT (home slates carry the FCS buy games),
    // which is why the blend below centers on the observed raw mean.
    rawHfaById.set(team.id, h !== null && a !== null ? clamp((h - a) / 2, 0, 6) : null);
  }
  const rawHfaVals = [...rawHfaById.values()].filter((v): v is number => v !== null);
  const meanRawHfa =
    rawHfaVals.length > 0 ? rawHfaVals.reduce((s, v) => s + v, 0) / rawHfaVals.length : null;
  for (const team of fbs) {
    const raw = rawHfaById.get(team.id) ?? null;
    // Centered blend (2026.4.1): mean applied HFA equals the fitted baseHfa,
    // between-team spread survives. See centeredBlendedHfa in ratings.ts.
    const blended = centeredBlendedHfa(raw, meanRawHfa);
    hfaById.set(team.id, blended);
    hfaRows.push({ team_id: team.id, raw_hfa: raw !== null ? r2(raw) : null, blended_hfa: r2(blended) });
  }
  if (meanRawHfa !== null) {
    const meanBlended = [...hfaById.values()].reduce((s, v) => s + v, 0) / hfaById.size;
    console.log(
      `  team HFA: raw mean ${meanRawHfa.toFixed(2)} → blended mean ${meanBlended.toFixed(2)} (baseHfa ${DEFAULT_PARAMS.baseHfa})`,
    );
  }
  await emit("team_hfa", hfaRows);

  // Week-0 halves. off+def must equal overall EXACTLY (to the cent): the
  // ratings-update job carries these halves all season and the model's
  // invariant is overall ≡ offense + defense, so any rounding gap here would
  // compound into margins. Tilt is applied then the halves are re-derived
  // from the rounded overall so the sum is exact by construction.
  const preseasonTilts = TILT_CARRY ? chainTilts(replayTilts, TILT_CARRY) : new Map<number, number>();
  const ratingRows = preseason.map((p) => {
    const overall = r2(p.rating);
    const tilt = r2(preseasonTilts.get(p.teamId) ?? 0);
    const offense = r2(overall / 2 + tilt);
    return {
      season_id: SEASON,
      team_id: p.teamId,
      week: 0,
      overall,
      offense,
      defense: r2(overall - offense),
      tempo: 70,
      prior_weight: 1,
      model_version: MODEL_VERSION,
    };
  });
  for (const r of ratingRows) {
    if (Math.abs((r.offense as number) + (r.defense as number) - (r.overall as number)) > 1e-9) {
      throw new Error(`week-0 halves do not sum to overall for team ${r.team_id}`);
    }
  }
  await emit("ratings", ratingRows);

  await emit(
    "preseason_components",
    preseason.map((p) => ({
      season_id: SEASON,
      team_id: p.teamId,
      final_prev_rating: p.finalPrev !== null ? r2(p.finalPrev) : null,
      talent_baseline: r2(p.talent),
      churn_adjustment: r2(p.churn),
      coaching_adjustment: p.coaching,
      luck_correction: r2(p.luckCorr),
      returning_prod_off: p.retOff !== null ? r2(p.retOff) : null,
      returning_prod_usage: p.retUsage !== null ? r2(p.retUsage) : null,
      detail: {
        proxies: ["ol_share=0.5", "turnover_margin=0"],
        // Which season's talent file this rating was actually built on, and
        // whether that is the one it should have been. Stamped on every row
        // (not just the forced ones) so absence means "built before this
        // existed" rather than "fresh" — /model only ever renders the
        // affirmative, and a rebuild on real data clears the note by writing
        // talent_stale: false over it.
        talent_source: talentIsStale ? SEASON - 1 : SEASON,
        talent_stale: talentIsStale,
        // Auditability: what the coaching number was derived from, even when
        // the fitted params make it 0.
        new_hc: p.coach !== null,
        coach: p.coach,
        coach_over_perf: p.overPerf !== null ? r2(p.overPerf) : null,
        tilt_carry: TILT_CARRY,
        // The team's share of the market-anchored tier recentre — the sixth
        // term of "how the number is built"; without it the component tiles
        // no longer sum to the rating.
        tier_level: tierRecenter
          ? r2(tierById.get(p.teamId) === "P4" ? tierRecenter.p4 : tierRecenter.g5)
          : null,
        tier_recenter: tierRecenter
          ? { shift: r2(tierRecenter.shift), n: tierRecenter.n }
          : null,
      },
    })),
  );

  // ---- 9. Frozen week-1 predictions ----------------------------------------
  console.log("Pricing week 1…");
  const ratingById = new Map(preseason.map((p) => [p.teamId, p.rating]));
  const linesById = new Map(lines2026.map((l) => [l.id, l]));
  const week1 = (games2026 as CfbdGame[]).filter((g) => g.week === 1 && g.seasonType === "regular");

  // Price week 1 off the SAME halves that were just written to ratings, so
  // this batch and the ratings-update job start from identical state.
  const halvesById = new Map(
    ratingRows.map((r) => [
      r.team_id as number,
      { offense: r.offense as number, defense: r.defense as number },
    ]),
  );
  // Totals are real only when the halves carry information; a pure even split
  // prices every game at the league baseline (exactly 57.0 at tempo 70), which
  // is a constant, not a prediction. Same gate the freeze job uses.
  const totalsAreReal = splitInformative([...halvesById.values()]);
  // Week-1 uncertainty: identity until priorSigmaExtra is fit, then wider.
  const week1Params = paramsForWeek(1, DEFAULT_PARAMS);
  console.log(
    `  totals ${totalsAreReal ? "priced (informative off/def split)" : "withheld (even split — would be a constant)"}`,
  );

  const predRows: Row[] = [];
  for (const g of week1) {
    const homeR = ratingById.get(g.homeId);
    const awayR = ratingById.get(g.awayId);
    if (homeR === undefined && awayR === undefined) continue; // non-FBS matchup
    const rating = (teamId: number, overall: number | undefined): TeamRating => {
      if (overall === undefined) {
        // No FBS rating = an FCS opponent. Same bucket rule the jobs use.
        const f = fcsRatingOf(teamId, fcsTop, DEFAULT_PARAMS);
        return { overall: f, offense: f / 2, defense: f / 2, tempo: 70 };
      }
      const halves = halvesById.get(teamId);
      return {
        overall,
        offense: halves?.offense ?? overall / 2,
        defense: halves?.defense ?? overall / 2,
        tempo: 70,
      };
    };
    const vegasRaw = consensusLine(linesById.get(g.id));
    const vegas = vegasRaw !== null ? Math.round(vegasRaw * 10) / 10 : null;
    const price = priceGame(
      {
        home: rating(g.homeId, homeR),
        away: rating(g.awayId, awayR),
        homeTeamHfa: hfaById.get(g.homeId) ?? DEFAULT_PARAMS.baseHfa,
        neutralSite: g.neutralSite,
        situationalPoints: 0,
        vegasSpread: vegas,
      },
      week1Params,
    );
    predRows.push({
      game_id: g.id,
      // Receipts filters on season_id; rows without it silently vanish from
      // the page (migration 0014 backfilled the old nulls exactly once).
      season_id: SEASON,
      model_version: MODEL_VERSION,
      frozen: true,
      spread: Math.round(price.spread * 10) / 10,
      total: totalsAreReal ? Math.round(price.projectedTotal * 10) / 10 : null,
      home_score: totalsAreReal ? Math.round(price.projectedHomeScore * 10) / 10 : null,
      away_score: totalsAreReal ? Math.round(price.projectedAwayScore * 10) / 10 : null,
      home_win_prob: Math.round(price.homeWinProb * 10000) / 10000,
      cover_prob: price.homeCoverProb !== null ? Math.round(price.homeCoverProb * 10000) / 10000 : null,
      vegas_spread: vegas,
      edge: price.edge !== null ? Math.round(price.edge * 10) / 10 : null,
      edge_flag: price.edgeFlag,
      consensus_flag: price.consensusFlag,
    });
  }
  // Invariant: a stored total is only ever a real projection. If the halves
  // are even, every total must be null — never a constant dressed as one.
  const storedTotals = predRows.filter((r) => r.total !== null).length;
  if (!totalsAreReal && storedTotals > 0) {
    throw new Error(`${storedTotals} predictions carry a total from an uninformative off/def split`);
  }
  await emit("predictions", predRows);

  console.log(`\nDone: ${fileNo} JSON files in ${outDir}/`);
  console.log(`Week 1 games priced: ${predRows.length} (of ${week1.length} on the slate)`);
}

/**
 * Meter this run's CFBD calls into `api_call_log` (07:OPS-14a).
 *
 * This script was the largest unmetered consumer left: `preseason-refresh`
 * runs it daily through August (`jobs.yml:239`) and each firing is two
 * invocations — a `--check` and, when that passes, a full build — so the
 * budget the admin freshness card reports was structurally low all month, in
 * exactly the weeks the number is worth reading.
 *
 * Best-effort, like the probe's (`probe-cfbd.ts:158`): the script's real job is
 * to write JSON to disk and it must still do that on a machine that has a CFBD
 * key and no Supabase service credentials. A meter that could fail the build it
 * measures would be a worse trade than an occasional missing count.
 *
 * Runs from `finally` so the `--check` path — which returns early twice — and a
 * thrown build are counted too. Calls already spent are spent; not recording
 * them is what made the ledger wrong.
 */
async function meterCfbdCalls(): Promise<void> {
  const calls = cfbdCallCount();
  if (calls <= 0) return;
  const task = process.argv.includes("--check") ? "preseason-check" : "build-preseason";
  try {
    await logCfbdCalls(createServiceClient(), task, calls);
  } catch {
    console.warn(`::warning::${calls} CFBD calls went unmetered (no Supabase credentials)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(meterCfbdCalls);

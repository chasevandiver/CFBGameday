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
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cfbd, type CfbdGame } from "../src/lib/cfbd";
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
import { buildCoachTransitions } from "./lib/coaching";
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

const SEASON = 2026;
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
const TILT_CARRY = Number(process.env.PRESEASON_TILT_CARRY ?? 0.4);

type Row = Record<string, string | number | boolean | null | object>;

async function main() {
  const outArg = process.argv.indexOf("--out");
  const outDir = outArg > -1 ? process.argv[outArg + 1] : ".preseason-json";
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

  // ---- 3. Talent baseline (points scale) ------------------------------------
  const talentVals = talent.map((t) => t.talent);
  const tMean = talentVals.reduce((a, b) => a + b, 0) / talentVals.length;
  const tStd = Math.sqrt(talentVals.reduce((a, b) => a + (b - tMean) ** 2, 0) / talentVals.length);
  const talentBaseline = new Map<number, number>();
  for (const t of talent) {
    const team = teamByName.get(t.team);
    if (team) talentBaseline.set(team.id, clamp(((t.talent - tMean) / tStd) * 5.5, -18, 18));
  }

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
  const portalVals = [...portalNet.values()];
  const pStd =
    Math.sqrt(portalVals.reduce((a, b) => a + b * b, 0) / Math.max(portalVals.length, 1)) || 1;

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
    retDef: number | null;
  }
  const preseason: Preseason[] = [];
  const missingCoachData: string[] = [];
  for (const team of fbs) {
    const finalPrev = finals.get(team.id) ?? null;
    const tal = talentBaseline.get(team.id) ?? -8;
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
        netPortalPoints: clamp(((portalNet.get(team.id) ?? 0) / pStd) * 1.5, -4, 4),
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
      retDef: ret?.usage ?? null,
    });
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
        `talent: ${talentDefaults} FBS teams unmatched — each takes the −8 default`,
      );
    }
    const missingRet = preseason.filter((p) => p.retOff === null).length;
    if (missingRet > 5) problems.push(`returning production: ${missingRet} teams unmatched`);
    if (newHires === 0) problems.push("coaches: no head-coach changes detected — check the feed");
    const clampedNow = preseason.filter((p) => Math.abs(Math.abs(p.churn) - 6) < 0.001).length;
    if (clampedNow > 15) problems.push(`churn: ${clampedNow} teams at the ±6 clamp`);

    console.log(`\n=== preseason readiness for ${SEASON} ===`);
    if (problems.length === 0) {
      console.log("READY — every input is live. Safe to run the real build and load.");
      return;
    }
    for (const p of problems) console.log(`  NOT READY — ${p}`);
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
    console.log(`  note: ${noTalent} team(s) had no talent match — each took the −8 default`);
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
  const homeMargins = new Map<number, number[]>();
  const awayMargins = new Map<number, number[]>();
  for (let year = 2015; year <= 2024; year++) {
    const games = await cached(`games-${year}`, () => cfbd.games(year), true);
    for (const g of games) {
      if (g.homePoints === null || g.awayPoints === null || g.neutralSite) continue;
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
      returning_prod_def: p.retDef !== null ? r2(p.retDef) : null,
      detail: {
        proxies: ["ol_share=0.5", "turnover_margin=0"],
        // Auditability: what the coaching number was derived from, even when
        // the fitted params make it 0.
        new_hc: p.coach !== null,
        coach: p.coach,
        coach_over_perf: p.overPerf !== null ? r2(p.overPerf) : null,
        tilt_carry: TILT_CARRY,
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
        return { overall: -30, offense: -15, defense: -15, tempo: 70 };
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * The shipping gate for the tier-leveling fix: rebuild the 2026 preseason
 * ratings under candidate prior constructions and score each against the
 * Week-1 2026 market.
 *
 * Pre-registered gate (all four must hold for a candidate to ship):
 *   1. cross-tier (P4 vs G5) mean edge vs the Week-1 market, G5-signed:
 *      |t| < 2 (the defect measured +9.8, t = 7.7 on 2026-08-12);
 *   2. P4-vs-P4 mean edge stays within ±1.0 (it is ~0 today — a fix that
 *      levels the tiers by wrecking what already works is not a fix);
 *   3. pooled backtest MAE ≤ 13.30 and NLL ≤ 0.5005 (scored by
 *      `backtest.ts --diagnose-tiers`, not here — different data);
 *   4. win-prob calibration within ~3 pts in every bucket (same).
 *
 * This script REPLICATES build-preseason.ts's rating assembly (steps 1–6)
 * rather than importing it, because that file is a monolithic main() and
 * refactoring the production build script 17 days before kickoff is a worse
 * risk than a diagnostic that could drift. If the two ever disagree, the
 * build script is the truth — check the "baseline reproduces the measured
 * defect" line below before trusting anything else printed here.
 *
 * Differences from the production build, deliberate and printed:
 *  - flat baseHfa everywhere (production uses the centered team-HFA blend,
 *    whose MEAN is pinned to baseHfa, so slice means move by tenths at most);
 *  - talent falls back to 2025 exactly like the build does while CFBD has not
 *    published 2026 talent.
 *
 * Usage: CFBD_API_KEY=… npx tsx scripts/diagnose-tiers-2026.ts [--examples]
 */

import { cfbd, type CfbdGame } from "../src/lib/cfbd";
import {
  DEFAULT_PARAMS,
  churnAdjustment,
  clamp,
  coachingAdjustmentContinuous,
  luckCorrection,
  preseasonRating,
} from "../src/model/ratings";
import { buildCoachTransitions } from "./lib/coaching";
import { portalPoints, portalScale } from "./lib/portal";
import {
  FCS_RATING,
  cached,
  chainPriors,
  consensusLine,
  loadSeason,
  priorsFromSp,
  replaySeason,
  teamIdsByNameFrom,
  type SeasonData,
} from "./lib/replay";
import { stat, type SliceStat } from "./lib/slices";
import { tierOf, type Tier } from "./lib/tiers";

const SEASON = Number(process.env.CFB_SEASON ?? 2026);
const REPLAY_SEASONS = [2023, 2024, 2025];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Between-season prior construction for the replay chain. */
type Intermediate = "bare" | "talent" | "sp+talent";

interface Candidate {
  label: string;
  /** How priors chain between replay seasons (2023→24, 2024→25). */
  intermediate: Intermediate;
  /** REPLAY_SHARE for the final 2025 baseline: α×replay + (1−α)×SP+. */
  finalAlpha: number;
  fcs?: number;
}

const CANDIDATES: Candidate[] = [
  { label: "C0 production today (bare chain, α=0.50)", intermediate: "bare", finalAlpha: 0.5 },
  { label: "C1 bare chain, α=0.25", intermediate: "bare", finalAlpha: 0.25 },
  { label: "C2 bare chain, α=0.00 (SP+ is the baseline)", intermediate: "bare", finalAlpha: 0 },
  { label: "C3 talent chain, α=0.50", intermediate: "talent", finalAlpha: 0.5 },
  { label: "C4 sp+talent chain, α=0.50", intermediate: "sp+talent", finalAlpha: 0.5 },
  { label: "C5 sp+talent chain, α=0.25", intermediate: "sp+talent", finalAlpha: 0.25 },
];

async function main() {
  const examples = process.argv.includes("--examples");

  // ---- data ---------------------------------------------------------------
  const seasons: SeasonData[] = [];
  for (const s of REPLAY_SEASONS) seasons.push(await loadSeason(s, true));
  const idsByName = teamIdsByNameFrom(seasons);

  const spBySeason = new Map<number, Map<number, number>>();
  const talentBySeason = new Map<number, Map<number, number>>();
  for (const season of REPLAY_SEASONS) {
    const sp = await cached(`sp-${season}`, () => cfbd.spRatings(season), true);
    spBySeason.set(season, priorsFromSp(sp, idsByName));
    const talent = await cached(`talent-${season}`, () => cfbd.talent(season), true);
    const vals = talent.map((t) => t.talent);
    const m = mean(vals);
    const std = Math.sqrt(mean(vals.map((v) => (v - m) ** 2)));
    const map = new Map<number, number>();
    for (const t of talent) {
      const id = idsByName.get(t.team);
      if (id !== undefined) map.set(id, clamp(((t.talent - m) / std) * 5.5, -18, 18));
    }
    talentBySeason.set(season, map);
  }

  const [teams, games2026, lines2026, returning, portal] = await Promise.all([
    cached(`teams-${SEASON}`, () => cfbd.teams(SEASON), true),
    cached(`games-${SEASON}`, () => cfbd.games(SEASON), true),
    cached(`lines-${SEASON}`, () => cfbd.lines(SEASON), true),
    cached(`returning-${SEASON}`, () => cfbd.returningProduction(SEASON), true),
    cached(`portal-${SEASON}`, () => cfbd.portal(SEASON), true),
  ]);
  const coachRows = await cached(
    `coaches-${SEASON}`,
    () => cfbd.coaches({ minYear: 2001, maxYear: SEASON }),
    true,
  );
  const transitions = buildCoachTransitions(coachRows, SEASON);

  let talent2026 = await cached(`talent-${SEASON}`, () => cfbd.talent(SEASON), true);
  if (talent2026.length === 0) {
    console.log(`(no ${SEASON} talent yet — using ${SEASON - 1}, same fallback as the build)`);
    talent2026 = await cached(`talent-${SEASON - 1}`, () => cfbd.talent(SEASON - 1), true);
  }

  const fbs = teams.filter((t) => t.classification === "fbs");
  const teamByName = new Map(teams.map((t) => [t.school, t]));
  const schoolOf = new Map(fbs.map((t) => [t.id, t.school]));

  // ---- talent baseline for 2026 (build-preseason step 3, replicated) -------
  const tVals = talent2026.map((t) => t.talent);
  const tMean = mean(tVals);
  const tStd = Math.sqrt(mean(tVals.map((v) => (v - tMean) ** 2)));
  const talentBaseline = new Map<number, number>();
  for (const t of talent2026) {
    const team = teamByName.get(t.team);
    if (team) talentBaseline.set(team.id, clamp(((t.talent - tMean) / tStd) * 5.5, -18, 18));
  }
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

  // ---- churn/coaching/luck (build-preseason steps 4–6, replicated) ---------
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
  // Same standardization the build uses since the portal-scaling fix
  // (scripts/lib/portal.ts): centred on the FBS mean, scaled by FBS SD.
  const pScale = portalScale(
    fbs.map((t) => t.id),
    portalNet,
  );

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

  const adjustmentsFor = (team: { id: number; school: string; conference: string | null }) => {
    const tal = talentFor(team);
    const ret = returningByTeam.get(team.school);
    const retPassing = ret?.percentPassingPPA ?? null;
    const retOverall = ret?.percentPPA ?? null;
    const churn = churnAdjustment(
      {
        returningProduction: retOverall ?? 0.6,
        qbReturns: ret && retPassing !== null ? retPassing >= 0.5 : null,
        olReturningShare: 0.5,
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
          turnoverMargin: 0,
          oneScoreWins: l.oneScoreW,
          oneScoreLosses: l.oneScoreL,
        })
      : 0;
    const transition = transitions.get(team.school);
    const coaching = coachingAdjustmentContinuous(
      { newHc: transition?.newHc ?? false, overPerf: transition?.overPerf ?? null },
      DEFAULT_PARAMS,
    );
    return { tal, churn, luckCorr, coaching };
  };

  // ---- replay chain per candidate ------------------------------------------
  const chainStep = (
    finals: Map<number, number>,
    seasonJustPlayed: number,
    kind: Intermediate,
  ): Map<number, number> => {
    if (kind === "bare") return chainPriors(finals);
    const sp = spBySeason.get(seasonJustPlayed)!;
    const tal = talentBySeason.get(seasonJustPlayed)!;
    const next = new Map<number, number>();
    for (const [teamId, rating] of finals) {
      const s = sp.get(teamId);
      const base = kind === "sp+talent" && s !== undefined ? 0.5 * rating + 0.5 * s : rating;
      next.set(teamId, 0.7 * base + 0.3 * (tal.get(teamId) ?? -8));
    }
    return next;
  };

  const week1 = (games2026 as CfbdGame[]).filter(
    (g) => g.week === 1 && g.seasonType === "regular",
  );
  const linesById = new Map(lines2026.map((l) => [l.id, l]));
  const fbsById = new Map(fbs.map((t) => [t.id, t]));
  const tier2026 = (teamId: number): Tier => {
    const team = fbsById.get(teamId);
    if (!team) return "FCS";
    return tierOf(team.conference, team.school, SEASON, true);
  };
  const byTierIds: Record<"P4" | "G5", number[]> = { P4: [], G5: [] };
  for (const team of fbs) {
    const t = tier2026(team.id);
    if (t === "P4" || t === "G5") byTierIds[t].push(team.id);
  }

  console.log(
    `\nWeek 1 ${SEASON}: ${week1.length} games on the slate; flat baseHfa ${DEFAULT_PARAMS.baseHfa} ` +
      `(production uses the centered team-HFA blend whose mean is pinned to it)`,
  );
  console.log(
    "\ncandidate                                     cross-tier(G5-signed)      P4vP4     G5vG5     n(cross)",
  );

  interface Scored {
    cand: Candidate;
    rating: Map<number, number>;
    cross: SliceStat | null;
    p4: SliceStat | null;
    g5: SliceStat | null;
  }
  const scored: Scored[] = [];

  for (const cand of CANDIDATES) {
    let priors = priorsFromSp(seasons[0].prevSp, idsByName);
    let replayFinals = new Map<number, number>();
    for (const season of seasons) {
      const { finalRatings } = replaySeason(
        season,
        priors,
        DEFAULT_PARAMS,
        undefined,
        cand.fcs ?? FCS_RATING,
      );
      replayFinals = finalRatings;
      if (season.season < REPLAY_SEASONS[REPLAY_SEASONS.length - 1]) {
        priors = chainStep(finalRatings, season.season, cand.intermediate);
      }
    }

    // final 2025 baseline: α×replay + (1−α)×SP+2025 (build-preseason step 1½)
    const sp2025 = spBySeason.get(2025)!;
    const finals = new Map<number, number>();
    for (const [teamId, replayRating] of replayFinals) {
      const sp = sp2025.get(teamId);
      finals.set(
        teamId,
        sp !== undefined ? cand.finalAlpha * replayRating + (1 - cand.finalAlpha) * sp : replayRating,
      );
    }

    // preseason rating per FBS team (build-preseason step 6)
    const rating = new Map<number, number>();
    for (const team of fbs) {
      const { tal, churn, luckCorr, coaching } = adjustmentsFor(team);
      rating.set(
        team.id,
        preseasonRating({
          finalPrevRating: finals.get(team.id) ?? null,
          talentBaseline: tal,
          churnAdjustment: churn,
          coachingAdjustment: coaching,
          luckCorrection: luckCorr,
        }),
      );
    }

    // price week 1 vs market
    const crossEdges: number[] = [];
    const p4Edges: number[] = [];
    const g5Edges: number[] = [];
    for (const g of week1) {
      const vegas = consensusLine(linesById.get(g.id));
      if (vegas === null) continue;
      const homeR = rating.get(g.homeId);
      const awayR = rating.get(g.awayId);
      if (homeR === undefined || awayR === undefined) continue; // FBS-vs-FBS only
      const margin =
        homeR - awayR + (g.neutralSite ? 0 : DEFAULT_PARAMS.baseHfa);
      const edge = -margin - vegas; // + = we favour the away side vs market
      const ht = tier2026(g.homeId);
      const at = tier2026(g.awayId);
      if (ht === "P4" && at === "P4") p4Edges.push(-edge);
      else if (ht === "G5" && at === "G5") g5Edges.push(-edge);
      else if (ht === "P4" && at === "G5") crossEdges.push(edge);
      else if (ht === "G5" && at === "P4") crossEdges.push(-edge);
    }

    const cross = stat("cross", crossEdges);
    const p4 = stat("p4", p4Edges);
    const g5 = stat("g5", g5Edges);
    scored.push({ cand, rating, cross, p4, g5 });
    const f = (s: SliceStat | null, tStat = false) =>
      s
        ? `${s.mean >= 0 ? "+" : ""}${s.mean.toFixed(2)}${tStat ? ` ±${s.se.toFixed(2)} t=${s.t.toFixed(2)}` : ""}`
        : "–";
    const gate = cross && Math.abs(cross.t) < 2 ? "  ← gate 1 PASSES" : "";
    console.log(
      `${cand.label.padEnd(45)} ${f(cross, true).padEnd(24)}   ${f(p4).padEnd(9)} ${f(g5).padEnd(9)} ${
        cross?.n ?? 0
      }${gate}`,
    );
  }

  // ---- C6: the patch — week-1 market-anchored tier recentre ------------------
  // Shift the two pools (zero-sum) so the mean G5-signed cross-tier edge
  // against the week-1 lines is zero. NOTE: these same lines are the fit set,
  // so "t < 2" here is by construction, not evidence — the out-of-sample
  // validation is `backtest.ts --tune-tier-recenter` (fit wk-1, score wks 2–4
  // and outcomes on 2024–25) plus the 2026 weeks-2+ lines once they post.
  {
    const c0 = scored[0];
    const shift = c0.cross?.mean ?? 0;
    const tierById = new Map<number, Tier>();
    for (const id of byTierIds.P4) tierById.set(id, "P4");
    for (const id of byTierIds.G5) tierById.set(id, "G5");
    const { recenterTierGap, tierGapOf } = await import("./lib/tiers");
    const gap = tierGapOf(c0.rating, tierById);
    const patched = recenterTierGap(c0.rating, tierById, (gap ?? 0) + shift);

    let bigBefore = 0;
    let bigAfter = 0;
    const residuals: number[] = [];
    for (const g of week1) {
      const vegas = consensusLine(linesById.get(g.id));
      if (vegas === null) continue;
      const ht = tier2026(g.homeId);
      const at = tier2026(g.awayId);
      const cross = (ht === "P4" && at === "G5") || (ht === "G5" && at === "P4");
      if (!cross) continue;
      const edgeOf = (r: Map<number, number>) => {
        const hr = r.get(g.homeId);
        const ar = r.get(g.awayId);
        if (hr === undefined || ar === undefined) return null;
        const margin = hr - ar + (g.neutralSite ? 0 : DEFAULT_PARAMS.baseHfa);
        return -margin - vegas;
      };
      const before = edgeOf(c0.rating);
      const after = edgeOf(patched);
      if (before !== null && Math.abs(before) >= DEFAULT_PARAMS.bigEdgeThreshold) bigBefore++;
      if (after !== null && Math.abs(after) >= DEFAULT_PARAMS.bigEdgeThreshold) bigAfter++;
      if (after !== null) residuals.push(at === "G5" ? after : -after);
    }
    const res = stat("resid", residuals);
    console.log(
      `\n-- C6: C0 + week-1 market recentre (fit on these lines; gap ${gap?.toFixed(1)} → ${((gap ?? 0) + shift).toFixed(1)}, ` +
        `P4 +${((shift * byTierIds.G5.length) / (byTierIds.P4.length + byTierIds.G5.length)).toFixed(1)} / G5 −${(
          (shift * byTierIds.P4.length) /
          (byTierIds.P4.length + byTierIds.G5.length)
        ).toFixed(1)}) --`,
    );
    if (res) {
      console.log(
        `cross-tier residual: mean ${res.mean >= 0 ? "+" : ""}${res.mean.toFixed(2)} ±${res.se.toFixed(2)} ` +
          `SD ${res.sd.toFixed(2)} (per-game disagreement survives; only the systematic lean is removed)`,
      );
    }
    console.log(
      `BIG EDGE (≥${DEFAULT_PARAMS.bigEdgeThreshold}) flags on cross-tier games: ${bigBefore} before → ${bigAfter} after (of ${residuals.length} lined)`,
    );
  }

  // ---- shape of the residual: level offset or compressed scale? -------------
  // Regress the G5-signed cross-tier edge on the market's own (G5-signed) gap.
  // A pure pool-level offset shows up as intercept-only; a compressed rating
  // scale shows up as a slope (the bigger the market gap, the bigger our
  // shortfall). The fix shape follows from which one carries the number.
  {
    const c0 = scored[0];
    const xs: number[] = [];
    const ys: number[] = [];
    for (const g of week1) {
      const vegas = consensusLine(linesById.get(g.id));
      if (vegas === null) continue;
      const homeR = c0.rating.get(g.homeId);
      const awayR = c0.rating.get(g.awayId);
      if (homeR === undefined || awayR === undefined) continue;
      const ht = tier2026(g.homeId);
      const at = tier2026(g.awayId);
      if (!((ht === "P4" && at === "G5") || (ht === "G5" && at === "P4"))) continue;
      const margin = homeR - awayR + (g.neutralSite ? 0 : DEFAULT_PARAMS.baseHfa);
      const edge = -margin - vegas;
      const g5Away = at === "G5";
      const signedEdge = g5Away ? edge : -edge;
      // market's P4-minus-G5 margin for this game (positive = P4 better)
      const marketP4Gap = g5Away ? -vegas : vegas;
      xs.push(marketP4Gap);
      ys.push(signedEdge);
    }
    const { ols } = await import("./backtest");
    const { beta, se } = ols(ys, [xs]);
    console.log(
      `\n-- Cross-tier edge vs market gap (C0): edge = ${beta[0].toFixed(2)} (se ${se[0].toFixed(2)}) ` +
        `+ ${beta[1].toFixed(3)} (se ${se[1].toFixed(3)}) × marketGap   n=${ys.length} --`,
    );
    console.log(
      "intercept-only → pool-level offset (a recentre fixes it); a large slope → the rating",
    );
    console.log("scale itself is compressed and a constant shift leaves the biggest games wrong.");
  }

  // Pool spread: are the ratings under-dispersed WITHIN pools too?
  {
    const c0 = scored[0];
    const sd = (xs: number[]) => {
      const m = mean(xs);
      return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
    };
    const sp2025 = spBySeason.get(2025)!;
    for (const tier of ["P4", "G5"] as const) {
      const ids = byTierIds[tier];
      const ours = ids.map((id) => c0.rating.get(id)).filter((v): v is number => v !== undefined);
      const sps = ids.map((id) => sp2025.get(id)).filter((v): v is number => v !== undefined);
      console.log(
        `${tier} within-pool SD: ours ${sd(ours).toFixed(1)}   final 2025 SP+ ${sd(sps).toFixed(1)}`,
      );
    }
  }

  // ---- component attribution (baseline candidate) ---------------------------
  // Which term carries the tier gap? Mean by tier of every component, plus the
  // replay-final vs SP+ separations that feed the baseline.
  console.log("\n-- Component means by tier (C0 = production construction) --");
  const c0 = scored[0];
  const byTier: Record<"P4" | "G5", { id: number; school: string; conference: string | null }[]> = {
    P4: byTierIds.P4.map((id) => fbsById.get(id)!),
    G5: byTierIds.G5.map((id) => fbsById.get(id)!),
  };
  const compRows: Array<[string, (team: { id: number; school: string; conference: string | null }) => number | null]> = [
    ["rating (C0)", (t) => c0.rating.get(t.id) ?? null],
    ["talent", (t) => adjustmentsFor(t).tal],
    ["churn", (t) => adjustmentsFor(t).churn],
    ["coaching", (t) => adjustmentsFor(t).coaching],
    ["luck", (t) => adjustmentsFor(t).luckCorr],
  ];
  console.log("component        P4 mean    G5 mean    P4−G5");
  for (const [label, get] of compRows) {
    const p4v = byTier.P4.map(get).filter((v): v is number => v !== null);
    const g5v = byTier.G5.map(get).filter((v): v is number => v !== null);
    console.log(
      `${label.padEnd(15)} ${mean(p4v).toFixed(2).padStart(8)}   ${mean(g5v).toFixed(2).padStart(8)}   ${(
        mean(p4v) - mean(g5v)
      )
        .toFixed(2)
        .padStart(7)}`,
    );
  }
  // separation of the two baseline ingredients
  const sepOf = (m: Map<number, number>): string => {
    const p4v = byTier.P4.map((t) => m.get(t.id)).filter((v): v is number => v !== undefined);
    const g5v = byTier.G5.map((t) => m.get(t.id)).filter((v): v is number => v !== undefined);
    if (!p4v.length || !g5v.length) return "–";
    return (mean(p4v) - mean(g5v)).toFixed(2);
  };
  {
    // recompute C0's replay finals for the separation line
    let priors = priorsFromSp(seasons[0].prevSp, idsByName);
    let replayFinals = new Map<number, number>();
    for (const season of seasons) {
      const { finalRatings } = replaySeason(season, priors, DEFAULT_PARAMS);
      replayFinals = finalRatings;
      if (season.season < 2025) priors = chainPriors(finalRatings);
    }
    console.log(
      `\nP4−G5 separation of the baseline ingredients: replay finals ${sepOf(replayFinals)}   ` +
        `final 2025 SP+ ${sepOf(spBySeason.get(2025)!)}   talent ${sepOf(
          new Map([...fbs.map((t) => [t.id, talentFor(t)] as [number, number])]),
        )}`,
    );
  }

  // ---- worked examples -------------------------------------------------------
  if (examples) {
    console.log("\n-- Worked examples (our spread per candidate vs market) --");
    const names = ["Toledo", "Michigan State", "North Texas", "Indiana", "Texas State", "Texas", "Oklahoma State", "Tulsa"];
    const exGames = week1.filter(
      (g) => names.includes(g.homeTeam) && names.includes(g.awayTeam),
    );
    for (const g of exGames) {
      const vegas = consensusLine(linesById.get(g.id));
      const parts = scored.map((s) => {
        const hr = s.rating.get(g.homeId);
        const ar = s.rating.get(g.awayId);
        if (hr === undefined || ar === undefined) return `${s.cand.label.slice(0, 2)}: –`;
        const spread = -(hr - ar + (g.neutralSite ? 0 : DEFAULT_PARAMS.baseHfa));
        return `${s.cand.label.slice(0, 2)}: ${spread >= 0 ? "+" : ""}${spread.toFixed(1)}`;
      });
      console.log(
        `${g.awayTeam} @ ${g.homeTeam}  market ${vegas ?? "–"}   ${parts.join("  ")}`,
      );
    }
    // largest remaining cross-tier disagreements under the best candidate
    const best = scored.reduce((a, b) =>
      (b.cross && a.cross && Math.abs(b.cross.mean) < Math.abs(a.cross.mean)) ? b : a,
    );
    console.log(`\n(top-25 under ${best.cand.label})`);
    const ranked = [...best.rating.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    ranked.forEach(([id, r], i) =>
      console.log(`  ${String(i + 1).padStart(2)}. ${(schoolOf.get(id) ?? "?").padEnd(22)} ${r.toFixed(1)}`),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

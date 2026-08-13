/**
 * Serializable slate view model shared by the server loader, the /api/slate
 * refresh route, and the client slate UI — plus the pure grading math for
 * ATS / O-U results and the model report card.
 *
 * Spread convention everywhere: home perspective, negative = home favored.
 */

import { liveWinProb } from "../model/live";
import type { GroupBetView } from "./tailing";
import { spreadCoverSide, totalCoverSide } from "./cover";
import type { PickMarket } from "./grade";
import type { Sport } from "./league";
import { isDeadStatus } from "./void";

export interface TeamView {
  id: number;
  school: string;
  abbr: string;
  mascot: string | null;
  conference: string | null;
  color: string | null;
  altColor: string | null;
  logo: string | null;
  /** Model rank from the latest ratings week (1 = best), null if unrated */
  rank: number | null;
  /** Human-poll rank (AP/CFP/Coaches, latest week), null if unranked */
  pollRank: number | null;
  /** Which poll pollRank came from, e.g. "AP Top 25" */
  poll: string | null;
  /** "3-1" from final games this season, null before any finals */
  record: string | null;
  /** "2-1" from final conference games only, null before any conference finals */
  confRecord: string | null;
}

/** Rank to display on cards: the human poll when available, else the model's. */
export const displayRank = (t: TeamView): number | null => t.pollRank ?? t.rank;

export interface LinePoint {
  t: string;
  v: number;
}

export interface PredictionView {
  spread: number;
  total: number | null;
  homeScore: number | null;
  awayScore: number | null;
  homeWinProb: number;
  /** P(home covers vegasSpread); null when priced without a line */
  coverProb: number | null;
  vegasSpread: number | null;
  edge: number | null;
  edgeFlag: "EDGE" | "BIG_EDGE" | null;
  consensus: boolean;
  /** True for the Thursday-frozen receipts row */
  frozen: boolean;
}

export interface MyBetView {
  id: number;
  betType: string;
  side: string | null;
  line: number | null;
  /** Set once the Sunday grader settles it — the card prefers this to
   *  recomputing, so a bet type the grader handles by hand still reads right. */
  result?: string | null;
}

/** One of the viewer's picks on this game, in the group they're viewing. */
export interface MyPickView {
  market: PickMarket;
  side: string;
  /** Null for straight_up, which takes no number. */
  line: number | null;
}

/**
 * The number a picker actually holds, from a stored `line_at_pick`.
 *
 * Spreads are home-perspective everywhere in this codebase — `make_pick`
 * snapshots the raw consensus and `spreadClv` and the grader both read it that
 * way — so an away backer on a home −6.5 has a row saying −6.5 while what they
 * hold is +6.5. Every display path printed the stored number raw and so showed
 * away picks with the sign inverted. Totals are side-agnostic: over 51.5 and
 * under 51.5 are both 51.5.
 */
export function lineForSide(side: string, line: number | null): number | null {
  if (line === null) return null;
  // -0 survives into a rendered "−0", which is why negation goes through zero.
  return side === "away" ? (line === 0 ? 0 : -line) : line;
}

/**
 * Write-side inverse of `lineForSide`: the bettor states the number their
 * ticket reads ("UNC +6.5" → +6.5) and the ledger stores home-perspective
 * (−6.5), which is the convention the grader, live status and CLV all read.
 * The negation is symmetric so the implementation is shared — the second name
 * marks the direction of travel, so a write site reads as a conversion rather
 * than a display formatting call.
 */
export const homeLineForSide = lineForSide;

/**
 * How a pick reads: "UNC +6", "Over 51.5", "OSU to win".
 *
 * One implementation. There were five — the weekly grid, the game card, the
 * pick control, the game page and the share text each grew their own, and they
 * had already drifted on how straight-up is worded. Every one of them has to
 * call `lineForSide` first, which is the away-spread sign fix, so a sixth copy
 * is a sixth chance to reintroduce a bug the whole codebase has already had.
 *
 * `compact` is the difference between a card chip ("OSU ML") and a sentence
 * ("OSU to win"), which is the only thing the five ever legitimately disagreed
 * about.
 */
export function pickSideLabel(
  market: PickMarket,
  side: string,
  line: number | null,
  homeAbbr: string,
  awayAbbr: string,
  opts: { compact?: boolean } = {},
): string {
  // Coerced here rather than at the call sites. `fmtSpread` tests `spread === 0`
  // to print "PK", so a line arriving as the string "0" prints a bare "0" on the
  // home side — while the away side survives by accident, because `lineForSide`
  // negates it and `-"0"` is numeric `-0`. Three callers pass a `PickRow` field
  // straight through (the week page and both render sites on /game), and one
  // coercion at the single point every label already funnels through beats
  // three at the edges (UX-24). See `records.ts` for the same question answered
  // once for the arithmetic side.
  const n = line === null || line === undefined ? null : Number(line);
  const team = side === "home" ? homeAbbr : awayAbbr;
  if (market === "straight_up") return opts.compact ? `${team} ML` : `${team} to win`;
  if (market === "spread") return `${team} ${fmtSpread(lineForSide(side, n))}`;
  const over = side === "over";
  return opts.compact
    ? `${over ? "O" : "U"} ${fmtTotal(n)}`
    : `${over ? "Over" : "Under"} ${fmtTotal(n)}`;
}

/**
 * How many picks a board actually offers.
 *
 * Not games — a week with four games and both spreads and totals turned on is
 * eight picks, and the board said "8 of 4" to anyone who made them all. And
 * not games times markets either: a priced market with no posted line cannot
 * be picked at all, so a game nobody has hung a total on contributes its
 * spread and nothing else. Counting the buttons that exist is the only figure
 * that can't overstate what is achievable.
 */
export function pickableSlots(games: GameView[], markets: PickMarket[]): number {
  return games.reduce(
    (n, g) =>
      n +
      markets.filter((m) =>
        m === "spread" ? g.lines.spread !== null : m === "total" ? g.lines.total !== null : true,
      ).length,
    0,
  );
}

/**
 * How a logged BET reads as a ticket: "UGA +6.5", "O 54.5", "OSU ML".
 *
 * The bet-side twin of `pickSideLabel`, and it exists for the same reason:
 * `bets.line_taken` is stored home-perspective, so printing it raw shows every
 * away ticket with its sign inverted. That bug has already been fixed once
 * across five copies of the pick formatter — this is the function that stops
 * the sheet, the card and the share text growing three more.
 *
 * `bet_type` is a free-text column with types the model never prices
 * (team_total, first_half, future); those get the type name rather than a
 * number, which is the honest rendering of "we can't format this".
 */
export function betSideLabel(
  betType: string,
  side: string | null,
  line: number | null,
  homeAbbr: string,
  awayAbbr: string,
): string {
  const team = side === "home" ? homeAbbr : awayAbbr;
  if (betType === "total") return `${side === "over" ? "O" : "U"} ${fmtTotal(line)}`;
  if (betType === "moneyline") return `${team} ML`;
  if (betType === "spread") return `${team} ${fmtSpread(lineForSide(side ?? "home", line))}`;
  return line === null ? `${team} ${betType}` : `${team} ${betType} ${fmtTotal(line)}`;
}

/**
 * The pick a card leads with when it can only show one.
 *
 * A game can carry three of them now, but a card has one cover strip and one
 * aura. The spread is the headline where there is one — it is the market with
 * a number to be near — and otherwise the first pick made stands in.
 */
export function headlinePick(picks: MyPickView[]): MyPickView | null {
  return picks.find((p) => p.market === "spread") ?? picks[0] ?? null;
}

/** A crew mate's pick on this game (the viewer's own picks live in myPicks). */
export interface CrewPickView {
  name: string;
  side: string;
  /** Their season pick'em record, e.g. "12-8"; null before any graded picks */
  record: string | null;
}

export interface GameView {
  id: number;
  week: number;
  startTs: string | null;
  status: string;
  period: number | null;
  clock: string | null;
  /** Verbatim CFBD situation string while live, e.g. "2nd & 10 at OSU 34" */
  situation: string | null;
  /** One-line last play while live, so a reopened app shows what just changed */
  lastPlay: string | null;
  possession: "home" | "away" | null;
  tv: string | null;
  neutralSite: boolean;
  homePoints: number | null;
  awayPoints: number | null;
  home: TeamView;
  away: TeamView;
  lines: {
    spread: number | null;
    spreadOpen: number | null;
    total: number | null;
    totalOpen: number | null;
    mlHome: number | null;
    mlAway: number | null;
  };
  prediction: PredictionView | null;
  /** The viewer's picks in the active group — at most one per market. */
  myPicks: MyPickView[];
  /** The viewer's open (ungraded, unvoided) bets on this game */
  myBets: MyBetView[];
  /** Everyone else's picks on this game — who's riding which side */
  crewPicks: CrewPickView[];
  /**
   * The viewer's betting group on this game: who has money down, which side,
   * and who got there first. Empty when they're in no betting group — this is
   * the money layer, and it is deliberately independent of `crewPicks`, which
   * is the pool layer.
   */
  groupBets: GroupBetView[];
  weather: { tempF: number | null; windMph: number | null; precipProb: number | null } | null;
  dome: boolean;
  /** Seeded rivalry for this pairing (migration 0017); null when it isn't one */
  rivalry: RivalryView | null;
  /** Latest SP+/FPI/Elo for both sides (spec §2.4); empty when unsynced */
  systems: SystemRatingView[];
}

export interface RivalryView {
  name: string;
  /** Trophy on the line, when the rivalry plays for one */
  trophy: string | null;
}

/** One rating system's latest number for each side, in market convention. */
export interface SystemRatingView {
  system: "sp" | "fpi" | "elo";
  home: number | null;
  away: number | null;
}

export interface SlateData {
  seasonId: number;
  /** Which league this slate is — derived from the season id, never guessed. */
  sport: Sport;
  week: number;
  seasonType: "regular" | "postseason";
  fetchedAt: string;
  /**
   * Newest line snapshot across the week's games — when the lines on screen
   * were actually captured. Distinct from fetchedAt on purpose: the page can
   * be fresh while the lines are hours old (that's the designed cadence), and
   * a betting product must not dress one up as the other.
   */
  linesAsOf: string | null;
  games: GameView[];
}

export const isLive = (g: GameView) => g.status === "in_progress";
export const isFinal = (g: GameView) => g.status === "final";
export const isDead = (g: GameView) => isDeadStatus(g.status);

/* ---- live situation ---------------------------------------------------- */

export interface ParsedSituation {
  down: number;
  /** Yards to go, or "Goal" for goal-to-go */
  distance: number | "Goal";
  /** Field-side token as CFBD gives it, e.g. "OSU" in "at OSU 34" */
  sideToken: string;
  yardLine: number;
}

/** Best-effort parse of CFBD's situation string ("2nd & 10 at OSU 34"). */
export function parseSituation(s: string | null): ParsedSituation | null {
  if (!s) return null;
  const m = /^(\d)(?:st|nd|rd|th)\s*&\s*(\d+|goal)\s+at\s+(\S+)\s+(\d{1,2})$/i.exec(s.trim());
  if (!m) return null;
  return {
    down: Number(m[1]),
    distance: /^goal$/i.test(m[2]) ? "Goal" : Number(m[2]),
    sideToken: m[3],
    yardLine: Number(m[4]),
  };
}

/**
 * Red zone = ball inside the defense's 20 with possession known. Fails closed:
 * the raw situation string is the primary UI, this only adds a highlight when
 * the field-side token unambiguously matches the defending team's abbreviation.
 */
export function isRedZone(g: {
  status: string;
  possession: "home" | "away" | null;
  situation: string | null;
  home: { abbr: string };
  away: { abbr: string };
}): boolean {
  if (g.status !== "in_progress" || !g.possession) return false;
  const sit = parseSituation(g.situation);
  if (!sit) return false;
  if (sit.distance === "Goal") return true;
  const offense = g.possession === "home" ? g.home : g.away;
  const defense = g.possession === "home" ? g.away : g.home;
  const token = sit.sideToken.toUpperCase();
  if (token === offense.abbr.toUpperCase()) return false; // own side of the field
  if (token !== defense.abbr.toUpperCase()) return false; // ambiguous → no highlight
  return sit.yardLine <= 20;
}

export interface FieldPosition {
  /** 0 = away team's goal line, 100 = home team's goal line */
  x: number;
  /** Drive direction on a strip drawn away-left / home-right */
  dir: "left" | "right";
}

/**
 * Ball spot for the field strip, derived from the CFBD situation string.
 * Convention: the away team defends the left end zone, home the right, so
 * the offense always drives toward the defender's end. Fails closed (null)
 * when the field-side token matches neither team — same policy as isRedZone.
 */
export function fieldPosition(g: {
  status: string;
  possession: "home" | "away" | null;
  situation: string | null;
  home: { abbr: string };
  away: { abbr: string };
}): FieldPosition | null {
  if (g.status !== "in_progress" || !g.possession) return null;
  const sit = parseSituation(g.situation);
  if (!sit) return null;
  const token = sit.sideToken.toUpperCase();
  let x: number;
  if (token === g.home.abbr.toUpperCase()) x = 100 - sit.yardLine;
  else if (token === g.away.abbr.toUpperCase()) x = sit.yardLine;
  else return null;
  return { x, dir: g.possession === "away" ? "right" : "left" };
}

/**
 * In-game home win probability from score + time + pregame model margin.
 * Null unless the game is live. Computed client-side so realtime score
 * merges move the bar without a server round-trip.
 */
export function liveHomeWinProb(g: GameView): number | null {
  if (!isLive(g)) return null;
  return liveWinProb({
    pregameMargin: g.prediction ? -g.prediction.spread : 0,
    homePoints: g.homePoints ?? 0,
    awayPoints: g.awayPoints ?? 0,
    period: g.period,
    clock: g.clock,
  });
}

/* ---- formatting ------------------------------------------------------- */

export function fmtSpread(spread: number | null): string {
  if (spread === null) return "–";
  if (spread === 0) return "PK";
  return spread > 0 ? `+${spread}` : `${spread}`;
}

export function fmtMoneyline(ml: number | null): string {
  if (ml === null) return "–";
  return ml > 0 ? `+${ml}` : `${ml}`;
}

export function fmtPct(p: number | null): string {
  if (p === null) return "–";
  return `${Math.round(p * 100)}%`;
}

/** Half-points kept, whole numbers unpadded: 54.5 → "54.5", 54 → "54" */
export function fmtTotal(total: number | null): string {
  if (total === null) return "–";
  return `${total}`;
}

/* ---- market results (final games) ------------------------------------- */

export type SideResult = "home" | "away" | "push" | null;
export type OuResult = "over" | "under" | "push" | null;

/** Which side covered the closing spread. Null unless final with a line. */
export function atsResult(g: GameView, spread = g.lines.spread): SideResult {
  if (!isFinal(g) || spread === null || g.homePoints === null || g.awayPoints === null)
    return null;
  return spreadCoverSide(spread, g.homePoints, g.awayPoints);
}

export function ouResult(g: GameView, total = g.lines.total): OuResult {
  if (!isFinal(g) || total === null || g.homePoints === null || g.awayPoints === null)
    return null;
  return totalCoverSide(total, g.homePoints, g.awayPoints);
}

/* ---- model picks & grades --------------------------------------------- */

export interface ModelPicks {
  winner: "home" | "away" | null;
  /** ATS side vs the line the model priced against (null when no lean) */
  atsSide: "home" | "away" | null;
  ouLean: "over" | "under" | null;
}

export function modelPicks(g: GameView): ModelPicks {
  const p = g.prediction;
  if (!p) return { winner: null, atsSide: null, ouLean: null };
  const winner = p.homeWinProb >= 0.5 ? "home" : "away";
  const marketSpread = p.vegasSpread ?? g.lines.spread;
  let atsSide: "home" | "away" | null = null;
  if (marketSpread !== null) {
    const edge = p.edge ?? p.spread - marketSpread;
    // model spread below market spread → model likes home more than the market
    if (edge < 0) atsSide = "home";
    else if (edge > 0) atsSide = "away";
  }
  const marketTotal = g.lines.total;
  let ouLean: "over" | "under" | null = null;
  if (p.total !== null && marketTotal !== null && p.total !== marketTotal) {
    ouLean = p.total > marketTotal ? "over" : "under";
  }
  return { winner, atsSide, ouLean };
}

export interface ModelGrade {
  /** true = hit, false = miss, null = ungradeable or push */
  winner: boolean | null;
  ats: boolean | null;
  total: boolean | null;
}

export function gradeModel(g: GameView): ModelGrade {
  const picks = modelPicks(g);
  if (!isFinal(g) || g.homePoints === null || g.awayPoints === null)
    return { winner: null, ats: null, total: null };

  let winner: boolean | null = null;
  if (picks.winner && g.homePoints !== g.awayPoints) {
    winner = picks.winner === (g.homePoints > g.awayPoints ? "home" : "away");
  }

  const marketSpread = g.prediction?.vegasSpread ?? g.lines.spread;
  const cover = atsResult(g, marketSpread);
  let ats: boolean | null = null;
  if (picks.atsSide && cover && cover !== "push") ats = picks.atsSide === cover;

  const ou = ouResult(g);
  let total: boolean | null = null;
  if (picks.ouLean && ou && ou !== "push") total = picks.ouLean === ou;

  return { winner, ats, total };
}

export interface WeekRecord {
  wins: number;
  losses: number;
  pushes: number;
}

/**
 * Model ATS record across a slate's final games ("ATS 9-4").
 * Frozen predictions only — the report card grades receipts, never a number
 * that could have been re-priced after the fact (audit bug #12).
 */
export function weekModelRecord(games: GameView[]): WeekRecord {
  const rec = { wins: 0, losses: 0, pushes: 0 };
  for (const g of games) {
    if (!g.prediction?.frozen) continue;
    const picks = modelPicks(g);
    if (!picks.atsSide || !isFinal(g)) continue;
    const marketSpread = g.prediction?.vegasSpread ?? g.lines.spread;
    const cover = atsResult(g, marketSpread);
    if (!cover) continue;
    if (cover === "push") rec.pushes += 1;
    else if (cover === picks.atsSide) rec.wins += 1;
    else rec.losses += 1;
  }
  return rec;
}

/* ---- ATS / O-U trends (spec §6: for fun, never fed to the model) ------ */

export interface AtsGameInput {
  teamIsHome: boolean;
  /** Final home margin (home − away) */
  margin: number;
  /** Closing consensus spread, home perspective; null skips the game */
  closingSpread: number | null;
}

/** Team-perspective ATS record; same cover formula as the Sunday grader. */
export function atsRecord(games: AtsGameInput[]): { w: number; l: number; p: number } {
  const rec = { w: 0, l: 0, p: 0 };
  for (const g of games) {
    if (g.closingSpread === null) continue;
    const homeCover = g.margin + g.closingSpread;
    if (homeCover === 0) rec.p += 1;
    else if (homeCover > 0 === g.teamIsHome) rec.w += 1;
    else rec.l += 1;
  }
  return rec;
}

export function ouRecord(
  games: Array<{ totalPoints: number; closingTotal: number | null }>,
): { o: number; u: number; p: number } {
  const rec = { o: 0, u: 0, p: 0 };
  for (const g of games) {
    if (g.closingTotal === null) continue;
    if (g.totalPoints > g.closingTotal) rec.o += 1;
    else if (g.totalPoints < g.closingTotal) rec.u += 1;
    else rec.p += 1;
  }
  return rec;
}

/* ---- bet sizing (spec §5.4) ------------------------------------------- */

/**
 * Which side of the spread the model leans toward, or null when the game isn't
 * flagged. Same rule as modelPicks: a model spread below the market means the
 * model likes the home side.
 *
 * This replaced `stakeForPrediction`, which returned a ¼-Kelly unit size. The
 * 2023–25 backtest could not support a stake: flagged games went 49.2% against
 * the closing line (52.4% breaks even at −110), and the encompassing
 * regression put the model's coefficient at 0.035 (t=0.84) once the closing
 * line was included, against the market's 0.987. Sizing a bet off a cover
 * probability implies an edge that measurement doesn't find, so the lean is
 * surfaced as information and the number of units is not.
 */
export function modelSideOf(p: {
  edge: number | null;
  edgeFlag: "EDGE" | "BIG_EDGE" | null;
}): "home" | "away" | null {
  if (!p.edgeFlag || p.edge === null || p.edge === 0) return null;
  return p.edge < 0 ? "home" : "away";
}

/* ---- hero selection & line movement ----------------------------------- */

/**
 * "Game of the day" score: ranked matchups first (lower combined rank wins),
 * then closeness of spread, then total as a tiebreak. Dead games never win.
 */
export function heroScore(g: GameView): number {
  if (isDead(g)) return -Infinity;
  let score = 0;
  const hr = displayRank(g.home);
  const ar = displayRank(g.away);
  if (hr !== null && ar !== null && hr <= 25 && ar <= 25) score += 300 - (hr + ar) * 4;
  else if ((hr !== null && hr <= 25) || (ar !== null && ar <= 25)) score += 60;
  if (g.lines.spread !== null) score += Math.max(0, 25 - Math.abs(g.lines.spread)) * 2;
  if (g.lines.total !== null) score += g.lines.total / 10;
  return score;
}

export function pickHero(games: GameView[]): GameView | null {
  let best: GameView | null = null;
  let bestScore = -Infinity;
  for (const g of games) {
    const s = heroScore(g);
    if (s > bestScore) {
      best = g;
      bestScore = s;
    }
  }
  return best && bestScore > 0 ? best : null;
}

/** Signed movement from open to current (home perspective); null if unknown. */
export function spreadMove(g: GameView): number | null {
  const { spread, spreadOpen } = g.lines;
  if (spread === null || spreadOpen === null) return null;
  const d = Math.round((spread - spreadOpen) * 10) / 10;
  return d === 0 ? null : d;
}

export interface MoveRead {
  /** Signed move from open (home perspective) */
  delta: number;
  /** Set when the move is ≥1.5 pts and the model has a side: is the market
   *  steaming toward or away from the model's pick? (spec §4) */
  vsModel: "toward" | "away" | null;
}

/**
 * Line movement read against the model's side. Color only means something
 * when the model has a lean and the move is material — everything else is
 * neutral (the old indicator painted every drift green/red for no reason).
 */
export function spreadMoveRead(g: GameView): MoveRead | null {
  const delta = spreadMove(g);
  if (delta === null) return null;
  const edge = g.prediction?.edge ?? null;
  let vsModel: MoveRead["vsModel"] = null;
  if (edge !== null && edge !== 0 && Math.abs(delta) >= 1.5) {
    const modelSide = edge < 0 ? "home" : "away"; // same rule as modelPicks
    const marketToward = delta < 0 ? "home" : "away"; // spread dropped → toward home
    vsModel = marketToward === modelSide ? "toward" : "away";
  }
  return { delta, vsModel };
}

/* ---- watchability (spec §7) -------------------------------------------- */

/**
 * Watchability 0–100 (spec §7 defines the formula shape; weights tuned by
 * feel): closeness of spread + combined team quality (poll/model rank as the
 * available proxy for ratings) + expected points, on a base of 10, plus the
 * rivalry term the formula was always meant to carry (migration 0017 seeded
 * the data). Null for dead games.
 *
 * The rivalry bonus is deliberately small. A rivalry makes a mediocre game
 * worth watching; it does not make it a better game than two top-10 teams in
 * a one-score spread, which already scores near the cap without it.
 */
export function watchability(g: GameView): number | null {
  if (isDead(g)) return null;
  let score = 10;
  // closeness: PK → +35, 24+ point spread → +0
  score +=
    g.lines.spread === null ? 12 : Math.max(0, 35 - (Math.abs(g.lines.spread) * 35) / 24);
  // quality: each side rank 1 → +17.5 … rank 25 → ~+0.7; unranked → +2
  const q = (r: number | null) =>
    r === null || r > 25 ? 2 : (17.5 * (26 - r)) / 25;
  score += q(displayRank(g.home)) + q(displayRank(g.away));
  // shootout potential: total 38 → +0 … 75+ → +20
  score +=
    g.lines.total === null
      ? 8
      : Math.max(0, Math.min(1, (g.lines.total - 38) / 37)) * 20;
  // stakes: the trophy games people watch regardless of record
  if (g.rivalry) score += 10;
  return Math.round(Math.min(score, 100));
}

/**
 * Upset alert: a top-10 team trailing in the second half to a team ranked
 * 20+ spots worse (or unranked).
 */
export function upsetAlert(g: GameView): boolean {
  if (!isLive(g) || g.period === null || g.period < 3) return false;
  if (g.homePoints === null || g.awayPoints === null || g.homePoints === g.awayPoints)
    return false;
  const hr = displayRank(g.home);
  const ar = displayRank(g.away);
  const leadingIsHome = g.homePoints > g.awayPoints;
  const trailingRank = leadingIsHome ? ar : hr;
  const leadingRank = leadingIsHome ? hr : ar;
  if (trailingRank === null || trailingRank > 10) return false;
  return leadingRank === null || leadingRank - trailingRank >= 20;
}

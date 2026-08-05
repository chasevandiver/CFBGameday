/**
 * Serializable slate view model shared by the server loader, the /api/slate
 * refresh route, and the client slate UI — plus the pure grading math for
 * ATS / O-U results and the model report card.
 *
 * Spread convention everywhere: home perspective, negative = home favored.
 */

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
  /** "3-1" from final games this season, null before any finals */
  record: string | null;
}

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
  vegasSpread: number | null;
  edge: number | null;
  edgeFlag: "EDGE" | "BIG_EDGE" | null;
  consensus: boolean;
}

export interface GameView {
  id: number;
  week: number;
  startTs: string | null;
  status: string;
  period: number | null;
  clock: string | null;
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
  spreadHistory: LinePoint[];
  prediction: PredictionView | null;
  myPick: { side: string; line: number } | null;
  weather: { tempF: number | null; windMph: number | null; precipProb: number | null } | null;
  dome: boolean;
}

export interface SlateData {
  seasonId: number;
  week: number;
  fetchedAt: string;
  games: GameView[];
}

export const isLive = (g: GameView) => g.status === "in_progress";
export const isFinal = (g: GameView) => g.status === "final";
export const isDead = (g: GameView) => g.status === "postponed" || g.status === "canceled";

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
  const adj = g.homePoints - g.awayPoints + spread;
  if (adj > 0) return "home";
  if (adj < 0) return "away";
  return "push";
}

export function ouResult(g: GameView, total = g.lines.total): OuResult {
  if (!isFinal(g) || total === null || g.homePoints === null || g.awayPoints === null)
    return null;
  const pts = g.homePoints + g.awayPoints;
  if (pts > total) return "over";
  if (pts < total) return "under";
  return "push";
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

/** Model ATS record across a slate's final games ("ATS 9-4"). */
export function weekModelRecord(games: GameView[]): WeekRecord {
  const rec = { wins: 0, losses: 0, pushes: 0 };
  for (const g of games) {
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

/* ---- hero selection & line movement ----------------------------------- */

/**
 * "Game of the day" score: ranked matchups first (lower combined rank wins),
 * then closeness of spread, then total as a tiebreak. Dead games never win.
 */
export function heroScore(g: GameView): number {
  if (isDead(g)) return -Infinity;
  let score = 0;
  const hr = g.home.rank;
  const ar = g.away.rank;
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

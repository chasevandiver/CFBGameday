/**
 * SAL-1 — how much a game was *an event*.
 *
 * ## Why this exists
 *
 * Guess the Game drew its puzzle from every CFB regular-season final we hold a
 * score for, uniformly weighted. That is ~2,600 games rising to ~9,500 once the
 * archive reaches 2015, and the overwhelming majority of them are games nobody
 * in the crew watched. The owner's complaint — "way too random… hardly any
 * trivia" — is half a mechanic problem and half this: a puzzle about a Tuesday
 * MACtion game cannot reward knowing football, because there is nothing to
 * know.
 *
 * Changing the mechanic does not fix that half. A better question about a
 * forgettable game is still a question about a forgettable game. So all three
 * replacement games rank their deck through this.
 *
 * ## Shape
 *
 * Pure, no IO, every term its own named constant and its own test. The weights
 * are a judgement, not a fit — there is no training signal for "memorable" and
 * inventing one would be worse than saying so. What the tests pin is not the
 * numbers but the PROPERTIES: finite and non-negative on every input, monotone
 * per term, and a hand-ordered golden set that catches weights which are
 * individually sensible and collectively wrong.
 *
 * ## Ranking is not eligibility
 *
 * This scores; it never excludes. Each game defines its own eligibility
 * predicate for "can this support my questions" (The Tape needs a spread and a
 * total and a published poll; Depth Chart needs none of them). Folding the two
 * together would make a game with no line score zero AND vanish, and nothing
 * downstream could tell which happened.
 */

/**
 * Everything the score reads. Every market and poll field is nullable, because
 * the archive genuinely has holes: FCS buy games carry no line, and week 0 has
 * no poll. A null is "not known", never "zero".
 */
export interface SalienceGame {
  homePoints: number;
  awayPoints: number;
  /** Poll rank that week, 1–25. Null = unranked or no poll published. */
  homeRank: number | null;
  awayRank: number | null;
  /** Closing spread, home perspective, negative = home favoured. */
  spread: number | null;
  isRivalry: boolean;
  trophy: string | null;
  seasonType: string;
  /** CFBD's free text; carries the bowl name on a postseason game. */
  notes: string | null;
  neutralSite: boolean;
}

/**
 * The weights, one place. Frozen and exported so a test can read them rather
 * than restate them — a test that hardcodes 40 passes forever after somebody
 * changes the constant to 20.
 */
export const SALIENCE = {
  /** Both teams ranked: the sum of their rank quality. */
  bothRanked: 1,
  /** A ranked team lost. The headline of most weeks. */
  rankedLost: 12,
  /** Per point of closing spread, when the dog won outright. */
  upsetPerPoint: 1.6,
  /** On top of the above, once the dog was double digits. The "where were you". */
  bigDog: 18,
  rivalry: 14,
  /** A named trophy, on top of the rivalry term. */
  trophy: 6,
  postseason: 10,
  /** A postseason game CFBD named — a bowl, on top of the above. */
  namedBowl: 6,
  /** A one-score finish, and the margin it stops counting at. */
  oneScore: 8,
  oneScoreMargin: 8,
  /** A shootout, from this many combined points, per point above it. */
  shootoutFrom: 70,
  shootoutPerPoint: 0.5,
  shootoutCap: 15,
  /** A neutral-site game is usually a kickoff showcase or a championship. */
  neutral: 3,
} as const;

/**
 * Rank quality, floored at the unranked baseline.
 *
 * Deliberately the same curve `marqueeScore` uses to pick the Guess the Lines
 * slate (`scripts/lib/daily-games.ts`), including its floor: the raw shape
 * gives #25 → 0.7 against unranked → 2.0, which is harmless as one term among
 * four on a display sort and wrong here, where it would let two unranked teams
 * outscore a #25. Restated rather than imported because the dependency runs
 * scripts → src and never the reverse (`src/lib/void.ts` records that
 * precedent); the shared value is the curve, and it has a test on both sides.
 */
export function rankQuality(rank: number | null): number {
  if (rank === null || rank > 25) return 2;
  return Math.max(2, (17.5 * (26 - rank)) / 25);
}

/** True when the game turned on a poll — either side ranked. */
export function anyRanked(g: SalienceGame): boolean {
  return g.homeRank !== null || g.awayRank !== null;
}

/**
 * How much of an event this game was. Higher is more memorable.
 *
 * Always a finite, non-negative number. That is not decoration: the archive is
 * full of games with no line and no poll, and a NaN here would make
 * `Array.sort` order-dependent garbage and corrupt the deck ranking silently.
 */
export function salienceScore(g: SalienceGame): number {
  let score = 0;

  const margin = g.homePoints - g.awayPoints;
  const total = g.homePoints + g.awayPoints;

  // Two ranked teams: a top-ten matchup should tower over a #24-vs-#25 one.
  if (g.homeRank !== null && g.awayRank !== null) {
    score += SALIENCE.bothRanked * (rankQuality(g.homeRank) + rankQuality(g.awayRank));
  }

  // A ranked team losing is the thing people remember about a week.
  const homeLost = margin < 0;
  const awayLost = margin > 0;
  if ((g.homeRank !== null && homeLost) || (g.awayRank !== null && awayLost)) {
    score += SALIENCE.rankedLost;
  }

  /* The upset, priced by the market rather than by the polls. A ranked team
     losing to another ranked team is not an upset; a 24-point dog winning is,
     whether or not anybody was ranked. Null spread contributes nothing rather
     than defaulting to zero, which would read as a pick'em. */
  if (g.spread !== null && margin !== 0) {
    const homeWasDog = g.spread > 0;
    const dogWon = (homeWasDog && margin > 0) || (!homeWasDog && margin < 0);
    if (dogWon) {
      const points = Math.abs(g.spread);
      score += SALIENCE.upsetPerPoint * points;
      if (points >= 10) score += SALIENCE.bigDog;
    }
  }

  if (g.isRivalry) {
    score += SALIENCE.rivalry;
    if (g.trophy !== null) score += SALIENCE.trophy;
  }

  if (g.seasonType === "postseason") {
    score += SALIENCE.postseason;
    if (g.notes !== null && g.notes.trim() !== "") score += SALIENCE.namedBowl;
  }

  /* A one-score finish, ramped so a 1-point game beats a 8-point one rather
     than a cliff at the boundary. */
  const absMargin = Math.abs(margin);
  if (absMargin <= SALIENCE.oneScoreMargin) {
    score += SALIENCE.oneScore * (1 - absMargin / (SALIENCE.oneScoreMargin + 1));
  }

  if (total > SALIENCE.shootoutFrom) {
    score += Math.min(
      SALIENCE.shootoutCap,
      SALIENCE.shootoutPerPoint * (total - SALIENCE.shootoutFrom),
    );
  }

  if (g.neutralSite) score += SALIENCE.neutral;

  return score;
}

/**
 * The deck, best first.
 *
 * Ties break on the game id so the order is TOTAL and deterministic. That is
 * load-bearing rather than tidy: every one of the three games picks its
 * content by rendezvous hash over this deck, and a deck whose order depends on
 * the query's row order would hand different players different puzzles.
 */
export function rankBySalience<T extends { id: number; salience: SalienceGame }>(
  games: T[],
): T[] {
  return [...games].sort(
    (a, b) => salienceScore(b.salience) - salienceScore(a.salience) || a.id - b.id,
  );
}

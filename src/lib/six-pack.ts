/**
 * The Six-Pack (R3-E2): six questions on the week, free to play, scored in
 * points. Pure — the job builds and settles through this, the page renders
 * through it, and neither owns a second copy of the rules.
 *
 * ## The closure rule, which is the whole design
 *
 * **Every question settles exclusively from the slate's own six games.** No
 * "any ranked team in the country", no league-wide scans. That rule is what
 * makes a question ungradable-proof: the grader's read set is exactly the
 * games the slate names, so a question can never sit forever waiting on data
 * that never arrives.
 *
 * It is also why several obvious questions are absent — total touchdowns,
 * first scorer, longest play, turnovers, halftime leaders. They need stats
 * we do not store (`game_team_stats` is unbuilt, STATUS SCORE-3), and a
 * question that grades only when an ingest happened to fire is worse than no
 * question at all.
 *
 * ## Voids
 *
 * A push on a cover or total, and any dead game, grade `void`. A void drops
 * out of BOTH the numerator and the perfect bar: five-for-five on a
 * five-gradable week IS a clean sheet. Same rule the streak uses — a dead
 * game breaks no run, and it must not deny somebody a perfect week either.
 */

export type SixPackKind = "winner" | "cover" | "total" | "margin" | "high_game";

export type SixPackResult = "correct" | "wrong" | "void";

export interface SixPackQuestion {
  idx: number;
  kind: SixPackKind;
  /** The game this asks about; null for slate-wide kinds (`high_game`). */
  gameId: number | null;
  /** The number the question was ASKED at, frozen at generation. */
  line: number | null;
  choices: string[];
  answer?: string | null;
}

/** What a settled game looks like to this module. */
export interface SixPackGame {
  id: number;
  status: string;
  homePoints: number | null;
  awayPoints: number | null;
}

export const MARGIN_BUCKETS = ["1-7", "8-14", "15+"] as const;

const DEAD = new Set(["postponed", "canceled", "cancelled"]);

const isFinal = (g: SixPackGame) =>
  g.status === "final" && g.homePoints !== null && g.awayPoints !== null;

/** Which bucket a final margin falls in. Zero is impossible on a final. */
export function marginBucket(margin: number): (typeof MARGIN_BUCKETS)[number] {
  const m = Math.abs(margin);
  if (m <= 7) return "1-7";
  if (m <= 14) return "8-14";
  return "15+";
}

/**
 * Settle one question. Returns the winning choice, `"void"` when it can never
 * settle (a dead game, or a push), or **null when it is simply not ready yet**
 * — the caller leaves those alone rather than guessing.
 *
 * The `kind` switch is exhaustive by construction: the `never` fallthrough
 * means a new kind added without a settler fails to compile, and the totality
 * test pins it at runtime too.
 */
export function settle(q: SixPackQuestion, games: SixPackGame[]): string | "void" | null {
  const byId = new Map(games.map((g) => [g.id, g]));

  if (q.kind === "high_game") {
    // Slate-wide: needs EVERY game it offers as a choice to be resolved.
    const ids = q.choices.map(Number);
    const rows = ids.map((id) => byId.get(id));
    if (rows.some((g) => g === undefined)) return null;
    const live = rows.filter((g) => !DEAD.has(g!.status));
    // Every candidate dead is unanswerable; otherwise dead ones drop out.
    if (live.length === 0) return "void";
    if (!live.every((g) => isFinal(g!))) return null;
    const totals = live.map((g) => ({
      id: g!.id,
      total: (g!.homePoints as number) + (g!.awayPoints as number),
    }));
    const best = Math.max(...totals.map((t) => t.total));
    const tied = totals.filter((t) => t.total === best);
    // A tie has no single highest-scoring game; nobody should win or lose it.
    return tied.length === 1 ? String(tied[0]!.id) : "void";
  }

  const g = q.gameId === null ? undefined : byId.get(q.gameId);
  if (!g) return null;
  if (DEAD.has(g.status)) return "void";
  if (!isFinal(g)) return null;

  const home = g.homePoints as number;
  const away = g.awayPoints as number;
  const margin = home - away;

  switch (q.kind) {
    case "winner":
      // A tie is impossible in CFB and rare in the NFL; either way nobody
      // called it, so it voids rather than settling against everyone.
      return margin === 0 ? "void" : margin > 0 ? "home" : "away";
    case "cover": {
      if (q.line === null) return "void";
      // Home-perspective line, the convention everywhere in this codebase.
      const cover = margin + q.line;
      return cover === 0 ? "void" : cover > 0 ? "home" : "away";
    }
    case "total": {
      if (q.line === null) return "void";
      const total = home + away;
      return total === q.line ? "void" : total > q.line ? "over" : "under";
    }
    case "margin":
      return margin === 0 ? "void" : marginBucket(margin);
    default: {
      const exhaustive: never = q.kind;
      return exhaustive;
    }
  }
}

export interface EntryLine {
  idx: number;
  choice: string;
  result: SixPackResult | null;
}

export interface EntryScore {
  correct: number;
  /** Questions that actually settled — voids excluded. */
  gradable: number;
  /** True when every gradable question was called and at least one settled. */
  perfect: boolean;
  /** Still waiting on a result. */
  pending: number;
}

/**
 * Score one entry. Voids leave both counts alone, so a postponement cannot
 * take a perfect week away from somebody who called everything that played.
 */
export function entryScore(lines: EntryLine[]): EntryScore {
  let correct = 0;
  let gradable = 0;
  let pending = 0;
  for (const l of lines) {
    if (l.result === null) {
      pending += 1;
      continue;
    }
    if (l.result === "void") continue;
    gradable += 1;
    if (l.result === "correct") correct += 1;
  }
  return {
    correct,
    gradable,
    perfect: gradable > 0 && pending === 0 && correct === gradable,
    pending,
  };
}

/**
 * How many completed weeks since anyone cleared the whole slate — derived,
 * never stored, so a re-grade moves it. Weeks arrive newest-first or in any
 * order; only fully graded weeks count, because a week still playing has not
 * failed to be cleared yet.
 */
export function rolloverWeeks(
  weeks: Array<{ week: number; anyPerfect: boolean; complete: boolean }>,
): number {
  const done = [...weeks].filter((w) => w.complete).sort((a, b) => b.week - a.week);
  let n = 0;
  for (const w of done) {
    if (w.anyPerfect) break;
    n += 1;
  }
  return n;
}

/** The question, in words. One definition, shared by the page and any share text. */
export function questionText(
  q: SixPackQuestion,
  labels: { home: string; away: string } | null,
): string {
  const fixture = labels ? `${labels.away} @ ${labels.home}` : "this game";
  switch (q.kind) {
    case "winner":
      return `Who wins ${fixture}?`;
    case "cover":
      return `Who covers ${fixture}? (${labels?.home ?? "Home"} ${q.line !== null && q.line > 0 ? "+" : ""}${q.line ?? ""})`;
    case "total":
      return `Over or under ${q.line} in ${fixture}?`;
    case "margin":
      return `How close is ${fixture}?`;
    case "high_game":
      return "Which of these is the highest-scoring game?";
    default: {
      const exhaustive: never = q.kind;
      return exhaustive;
    }
  }
}

/** How a choice reads on a button. */
export function choiceText(
  q: SixPackQuestion,
  choice: string,
  labelsFor: (gameId: number) => { home: string; away: string } | null,
): string {
  if (q.kind === "high_game") {
    const l = labelsFor(Number(choice));
    return l ? `${l.away} @ ${l.home}` : `Game ${choice}`;
  }
  const l = q.gameId === null ? null : labelsFor(q.gameId);
  if (choice === "home") return l?.home ?? "Home";
  if (choice === "away") return l?.away ?? "Away";
  if (choice === "over") return "Over";
  if (choice === "under") return "Under";
  return choice;
}

/**
 * Guess the Game (R2-C3) — the daily puzzle's pure parts.
 *
 * Selection is a RENDEZVOUS HASH: for a given day, every candidate game gets
 * `hash(day + ":" + id)` and the argmax wins. Unlike `hash(day) % n`, adding
 * or removing a candidate only ever changes the days that candidate itself
 * would have won — the backfill growing by a season doesn't reshuffle every
 * future puzzle. Deterministic: same day + same candidate set = same game,
 * for every player, with no job and no stored schedule.
 *
 * The ANSWER never passes through this module's callers to the client — the
 * route (/api/guess-game) is the only place hints are cut, and it cuts them
 * by attempt count. See 0059's header.
 */

export type GtgVerdict = "correct" | "conference" | "miss";

/** FNV-1a 32-bit — tiny, stable, and plenty for picking a game a day. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The day's game: rendezvous argmax. Null only for an empty deck. */
export function pickDailyGame(day: string, candidateIds: number[]): number | null {
  let bestId: number | null = null;
  let bestScore = -1;
  for (const id of candidateIds) {
    const score = fnv1a(`${day}:${id}`);
    if (score > bestScore || (score === bestScore && (bestId === null || id < bestId))) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
}

export interface GtgAnswerCtx {
  homeTeamId: number;
  homeConference: string | null;
  homeSchool: string;
  awaySchool: string;
  homePoints: number;
  awayPoints: number;
  season: number;
  week: number;
  spread: number | null;
}

export interface GtgGuessTeam {
  id: number;
  conference: string | null;
}

/** How one guess lands: the team, the right conference, or nothing. */
export function gtgVerdict(guess: GtgGuessTeam, answer: GtgAnswerCtx): GtgVerdict {
  if (guess.id === answer.homeTeamId) return "correct";
  if (
    guess.conference !== null &&
    answer.homeConference !== null &&
    guess.conference === answer.homeConference
  )
    return "conference";
  return "miss";
}

export interface GtgHint {
  label: string;
  value: string;
}

export const GTG_MAX_ATTEMPTS = 6;

/**
 * The reveal ladder. Hint 0 is free; each wrong guess buys the next. The
 * away team is the last hint before the final guess — at that point the
 * puzzle is "who lost this game at home / who hosted", which is still a
 * puzzle.
 */
export function gtgHints(answer: GtgAnswerCtx, attempts: number): GtgHint[] {
  const ladder: GtgHint[] = [
    { label: "Final score", value: `${answer.homePoints}–${answer.awayPoints} (home–away)` },
    {
      label: "Closing spread",
      value:
        answer.spread === null
          ? "no line survives for this one"
          : `home ${answer.spread > 0 ? "+" : ""}${answer.spread}`,
    },
    { label: "When", value: `${answer.season}, week ${answer.week}` },
    { label: "Home conference", value: answer.homeConference ?? "Independent" },
    { label: "The visitors", value: answer.awaySchool },
  ];
  // Hint 0 always; one more per attempt spent, capped at the ladder.
  return ladder.slice(0, Math.min(1 + attempts, ladder.length));
}

export interface GtgRowState {
  guesses: Array<{ name: string; verdict: GtgVerdict }>;
  attempts: number;
  solved_at: string | null;
}

/**
 * Everything the client is allowed to see, in one place so a test can pin
 * the contract: the answer appears ONLY once the game is over. The route
 * returns exactly this.
 */
export function gtgPayload(day: string, row: GtgRowState, answer: GtgAnswerCtx) {
  const solved = row.solved_at !== null;
  const done = solved || row.attempts >= GTG_MAX_ATTEMPTS;
  return {
    day,
    attempts: row.attempts,
    maxAttempts: GTG_MAX_ATTEMPTS,
    solved,
    done,
    guesses: row.guesses.map((g) => ({ name: g.name, verdict: g.verdict })),
    hints: gtgHints(answer, row.attempts),
    answer: done ? `${answer.awaySchool} @ ${answer.homeSchool}` : null,
  };
}

/** Spoiler-free share block: one emoji per attempt, nothing else. */
export function gtgShareString(day: string, verdicts: GtgVerdict[], solved: boolean): string {
  const cell = (v: GtgVerdict) => (v === "correct" ? "🟩" : v === "conference" ? "🟨" : "⬛");
  const row = verdicts.map(cell).join("");
  const score = solved ? `${verdicts.length}/${GTG_MAX_ATTEMPTS}` : `X/${GTG_MAX_ATTEMPTS}`;
  return `Guess the Game ${day} ${score}\n${row}`;
}

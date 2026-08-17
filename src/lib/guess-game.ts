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

/**
 * The pool a practice round draws from: the deck minus today's puzzle.
 *
 * Pure and exported for one reason — this is the no-spoilers guarantee. A
 * practice round that handed you the game everybody is playing together today
 * would ruin the only part of this feature that is shared, and "the route
 * filters it out" is a claim worth a test rather than a comment.
 */
export function practicePool(deck: number[], todaysGameId: number | null): number[] {
  return todaysGameId === null ? deck : deck.filter((id) => id !== todaysGameId);
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
  /** The home team's record BEFORE this game. Replaced the closing spread. */
  homeRecord: TeamRecord;
}

export interface TeamRecord {
  wins: number;
  losses: number;
}

export interface RecordGameLike {
  home_team_id: number;
  away_team_id: number;
  home_points: number | null;
  away_points: number | null;
}

/**
 * A team's record over the games given — which the caller has already
 * narrowed to the same season and to kickoffs before the puzzle's own.
 *
 * "Coming in" rather than the final record on purpose: it is the number you
 * would have known watching that day, and it does not give away how the
 * season ended. A game with no score is skipped rather than counted as a
 * loss, and a tie counts as neither — college football has not had one since
 * 1995, but the shape of the data still permits it and inventing a loss from
 * one would be a lie in a clue.
 */
export function recordEntering(games: RecordGameLike[], teamId: number): TeamRecord {
  let wins = 0;
  let losses = 0;
  for (const g of games) {
    if (g.home_points === null || g.away_points === null) continue;
    const isHome = g.home_team_id === teamId;
    if (!isHome && g.away_team_id !== teamId) continue;
    const mine = isHome ? g.home_points : g.away_points;
    const theirs = isHome ? g.away_points : g.home_points;
    if (mine > theirs) wins++;
    else if (mine < theirs) losses++;
  }
  return { wins, losses };
}

/** How a record reads as a clue. A blank one is a season opener, and says so. */
export function recordLine(r: TeamRecord): string {
  return r.wins + r.losses === 0 ? "opening the season" : `${r.wins}-${r.losses} coming in`;
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
  /**
   * The school this clue is ABOUT, when it is about one — so the client can
   * put a mark beside it. Named explicitly rather than left for the client to
   * scrape out of `value`: parsing a sentence for a team name is the kind of
   * thing that works until a school has "State" in it twice.
   *
   * Only ever a team the clue has already given away. The home team never
   * appears here before the game is over — that is the whole anti-spoiler
   * design, and a logo is as much of a giveaway as a name.
   */
  team?: string;
}

export const GTG_MAX_ATTEMPTS = 6;

export interface SchoolOption {
  school: string;
  abbreviation: string | null;
  /** For the mark beside a guess. Null on the two teams ESPN has no art for;
   *  `TeamMark` falls back to a colored monogram, which is why colour rides
   *  along and is never null in practice. */
  logo_url: string | null;
  color: string | null;
}

/**
 * Type-ahead matching for the guess box.
 *
 * **A convenience, never the authority.** The route resolves a guess against
 * `teams` on the server and is the only thing that decides what was guessed;
 * this exists so nobody has to wonder whether the box wants "UNT" or "North
 * Texas" (it takes either — the server matches school AND abbreviation). If
 * the two ever disagree the server wins and the worst case is a suggestion
 * that does not resolve, which costs no attempt.
 *
 * Ranked so the thing you are typing toward surfaces first: an exact hit,
 * then a school starting with what you typed, then an abbreviation starting
 * with it, then anything containing it. Ties keep alphabetical order, which
 * is the order the caller supplies.
 */
export function matchSchools(
  query: string,
  options: SchoolOption[],
  limit = 6,
): SchoolOption[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const rank = (o: SchoolOption): number => {
    const school = o.school.toLowerCase();
    const abbr = (o.abbreviation ?? "").toLowerCase();
    if (school === q || (abbr !== "" && abbr === q)) return 0;
    if (school.startsWith(q)) return 1;
    if (abbr !== "" && abbr.startsWith(q)) return 2;
    if (school.includes(q)) return 3;
    return 4;
  };

  return options
    .map((o, i) => ({ o, r: rank(o), i }))
    .filter((x) => x.r < 4)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.o);
}

/**
 * The reveal ladder. Hint 0 is free; each wrong guess buys the next. The
 * away team is the last hint before the final guess — at that point the
 * puzzle is "who lost this game at home / who hosted", which is still a
 * puzzle.
 */
export function gtgHints(answer: GtgAnswerCtx, attempts: number): GtgHint[] {
  const ladder: GtgHint[] = [
    { label: "Final score", value: `${answer.homePoints}–${answer.awayPoints} (home–away)` },
    /* This rung used to be the closing spread, and on a backfilled puzzle it
       was always "no line survives for this one" — `line_snapshots` holds
       nothing for 2023–25, because the backfill landed games and not lines.
       So the rung your FIRST wrong guess bought was a shrug. The home team's
       record coming in is always computable from games we now hold, and it is
       a better clue besides: it is what you would have known that day. */
    { label: "Home team", value: recordLine(answer.homeRecord) },
    { label: "When", value: `${answer.season}, week ${answer.week}` },
    { label: "Home conference", value: answer.homeConference ?? "Independent" },
    { label: "The visitors", value: answer.awaySchool, team: answer.awaySchool },
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
    /* The same two names in a shape the client can hang marks on. Gated on
       `done` exactly like `answer` is — one condition, both fields, so a
       future edit cannot reveal the crest while withholding the name. */
    answerTeams: done ? { away: answer.awaySchool, home: answer.homeSchool } : null,
  };
}

/** Spoiler-free share block: one emoji per attempt, nothing else. */
export function gtgShareString(day: string, verdicts: GtgVerdict[], solved: boolean): string {
  const cell = (v: GtgVerdict) => (v === "correct" ? "🟩" : v === "conference" ? "🟨" : "⬛");
  const row = verdicts.map(cell).join("");
  const score = solved ? `${verdicts.length}/${GTG_MAX_ATTEMPTS}` : `X/${GTG_MAX_ATTEMPTS}`;
  return `Guess the Game ${day} ${score}\n${row}`;
}

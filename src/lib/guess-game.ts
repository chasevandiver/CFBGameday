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

import { EMPTY_STATS, type GtgStats } from "./gtg-stats";
import type { Region } from "./regions";

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
  /** Census region of the home team's own stadium. Null if unresolvable. */
  homeRegion: Region | null;
  homeSchool: string;
  awaySchool: string;
  homePoints: number;
  awayPoints: number;
  season: number;
  week: number;
  /** The home team's record BEFORE this game. Replaced the closing spread. */
  homeRecord: TeamRecord;
  /** This game's kickoff, so a guessed team's record can be cut to the same
   *  instant. ISO, or null on the handful of rows with no kickoff. */
  startTs: string | null;
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
  /** Undefined when the caller did not resolve it; null when it resolved to
   *  nothing. Both leave the chip undecided — see `gtgMarks`. */
  region?: Region | null;
  record?: TeamRecord | null;
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
  guesses: GtgStoredGuess[];
  attempts: number;
  solved_at: string | null;
}

/**
 * Everything the client is allowed to see, in one place so a test can pin
 * the contract: the answer appears ONLY once the game is over. The route
 * returns exactly this.
 */
export function gtgPayload(
  day: string,
  row: GtgRowState,
  answer: GtgAnswerCtx,
  /** The caller's own record across every day they have played. */
  stats: GtgStats = EMPTY_STATS,
) {
  const solved = row.solved_at !== null;
  const done = solved || row.attempts >= GTG_MAX_ATTEMPTS;
  return {
    day,
    attempts: row.attempts,
    maxAttempts: GTG_MAX_ATTEMPTS,
    solved,
    done,
    /* Copied field by field rather than passed through, so a column added to
       the stored row cannot reach the client by accident. The two chip marks
       are safe to send: they compare the team you already named against an
       answer you already guessed at, and say nothing about who it is. */
    guesses: row.guesses.map((g) => ({
      name: g.name,
      verdict: g.verdict,
      region: g.region,
      record: g.record,
    })),
    hints: gtgHints(answer, row.attempts),
    answer: done ? `${answer.awaySchool} @ ${answer.homeSchool}` : null,
    /* The same two names in a shape the client can hang marks on. Gated on
       `done` exactly like `answer` is — one condition, both fields, so a
       future edit cannot reveal the crest while withholding the name. */
    answerTeams: done ? { away: answer.awaySchool, home: answer.homeSchool } : null,
    stats,
  };
}

/* ---- The board's presentation layer ------------------------------------
 *
 * Everything below is how a payload READS, not what it means. It lives here
 * rather than in the component for one reason: it is pure, and the three
 * things a redesign is most likely to get subtly wrong — which clue a slot
 * shows, which chip a verdict lights, what the share block claims — are all
 * cheaper to pin with a test than to eyeball on a phone.
 */

/**
 * The four clue slots a wrong guess buys, in ladder order.
 *
 * The ladder's rung 0 (the final score) is NOT here: the score is the hero of
 * the screen now, hoisted out of the clue list into the scoreboard block, so
 * the slots are the four rungs that are still bought one miss at a time.
 * Slot `i` corresponds to `gtgHints()` index `i + 1` and unlocks at
 * `attempts >= i + 1`.
 *
 * `label` is the client's wording, deliberately not the server's. The route
 * says "Home team" and "When"; a locked slot has to name what you are buying
 * clearly enough to decide whether to spend a guess on it, and "When" does
 * not do that.
 */
export const GTG_CLUE_SLOTS: ReadonlyArray<{ label: string }> = [
  { label: "Home team record" },
  { label: "Season" },
  { label: "Home conference" },
  { label: "The visitors" },
];

/**
 * The final score, dug back out of the first clue.
 *
 * The scoreboard needs two integers and the payload carries one sentence
 * ("31–17 (home–away)"), so this parses rather than reads a field. That is a
 * presentation-layer workaround, not a design: the honest fix is for
 * `gtgPayload` to carry `finalScore: { home, away }` alongside the hint, and
 * this function is exactly the shape that change would delete. Kept pure and
 * tested so the day the wording changes, a test fails instead of the hero
 * element rendering blank.
 *
 * Matched on the label first and position second — a reordered ladder should
 * lose the hero, not show week 4 as a score.
 */
export function parseFinalScore(hints: GtgHint[]): { home: number; away: number } | null {
  const h = hints.find((x) => x.label === "Final score");
  if (!h) return null;
  const m = /(\d+)\D+(\d+)/.exec(h.value);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

export type GtgChipState = "hit" | "miss" | "unknown";
export type GtgChipKey = "conf" | "region" | "record";

export interface GtgChip {
  key: GtgChipKey;
  label: string;
  state: GtgChipState;
}

/**
 * What one guess is worth, as the three things the board shows.
 *
 * `verdict` stays exactly what it was — the route's scoring reads it and
 * nothing about points has changed. The two new marks sit beside it rather
 * than inside it for that reason: a chip is presentation, a verdict is the
 * score, and folding them together would put the leaderboard one refactor
 * away from a design decision.
 *
 * **Undecidable is a real answer here.** A team whose region cannot be
 * resolved (no home venue on file, an international kickoff, a state CFBD
 * never sent) gets `unknown`, not `miss`. Painting a dark chip would claim a
 * comparison nobody performed, and this row is the only feedback the game
 * gives. The same goes for a record the caller did not look up.
 *
 * The one shortcut: a correct guess lights all three unconditionally. The
 * team you named IS the answer, so every attribute matches by definition —
 * and it should not go grey because that school happens to have a venue row
 * with no state.
 */
export function gtgMarks(guess: GtgGuessTeam, answer: GtgAnswerCtx): GtgMarks {
  const verdict = gtgVerdict(guess, answer);
  if (verdict === "correct") return { verdict, region: "hit", record: "hit" };

  const region: GtgChipState =
    guess.region == null || answer.homeRegion == null
      ? "unknown"
      : guess.region === answer.homeRegion
        ? "hit"
        : "miss";

  const record: GtgChipState =
    guess.record == null
      ? "unknown"
      : guess.record.wins === answer.homeRecord.wins &&
          guess.record.losses === answer.homeRecord.losses
        ? "hit"
        : "miss";

  return { verdict, region, record };
}

export interface GtgMarks {
  verdict: GtgVerdict;
  region: GtgChipState;
  record: GtgChipState;
}

/**
 * One stored guess. `region` and `record` are optional because rows written
 * before they existed do not carry them — jsonb, so there was no migration to
 * backfill and no reason to invent one. An old row reads `unknown` on those
 * two chips, which is exactly what it knows.
 */
export interface GtgStoredGuess {
  name: string;
  verdict: GtgVerdict;
  region?: GtgChipState;
  record?: GtgChipState;
}

/** How one stored guess reads as three chips. */
export function gtgChips(guess: GtgStoredGuess): GtgChip[] {
  const trivially: GtgChipState | null = guess.verdict === "correct" ? "hit" : null;
  return [
    {
      key: "conf",
      label: "Conf",
      state: guess.verdict === "miss" ? "miss" : "hit",
    },
    { key: "region", label: "Region", state: trivially ?? guess.region ?? "unknown" },
    { key: "record", label: "Record", state: trivially ?? guess.record ?? "unknown" },
  ];
}

const SHARE_CELL: Record<GtgChipState, string> = {
  hit: "🟨",
  miss: "⬛",
  unknown: "⬜",
};

/**
 * Spoiler-free share block: the chip grid, a header and a streak footer.
 *
 * Wordle's shape — one row per guess you actually spent, no padding out to
 * six, because a solve in two that ships four blank rows reads as a worse
 * result than it was. Three cells per row, in the same order and with the
 * same meaning as the chips on screen, so the block is legible to someone
 * who has played and gives away nothing to someone who has not: no school
 * names, no score, no conference.
 *
 * `streak` is the device-local count (see `gtg-stats.ts`); 0 drops the footer
 * rather than bragging about nothing.
 */
export function gtgShareBlock(
  day: string,
  guesses: GtgStoredGuess[],
  solved: boolean,
  streak = 0,
): string {
  const score = solved ? `${guesses.length}/${GTG_MAX_ATTEMPTS}` : `X/${GTG_MAX_ATTEMPTS}`;
  const grid = guesses
    .map((g) => gtgChips(g).map((c) => SHARE_CELL[c.state]).join(""))
    .join("\n");
  const footer = streak > 0 ? `\nStreak ${streak}` : "";
  return `Guess the Game · ${day} · ${score}\n${grid}${footer}`;
}

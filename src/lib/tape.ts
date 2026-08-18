/**
 * The Tape (TAPE-1) — one game from the archive a day, and five questions
 * about it.
 *
 * ## What this replaces, and why the ask is inverted
 *
 * Guess the Game hid the game and asked you to name it. With 266 schools and a
 * clue ladder that carried nothing until its last rung, the rational play was
 * to burn guesses to reach the rung that gave it away — which is what the
 * owner meant by "just trying to randomly guess a team". The information was
 * all in one place and it arrived too late to reason with.
 *
 * The Tape names the game up front and asks what happened in it. Every
 * question is a football question with a real knowledge gradient: worst case
 * is one in four instead of one in 266, and somebody who watched the game gets
 * all five. The questions also chain — once you know who won, "who was
 * favoured" is a different question than it was a moment ago — so the round
 * rewards reasoning as well as recall.
 *
 * ## Answers are frozen at generation, so there is no grading lane
 *
 * `six-pack.ts`'s closure rule says a question must settle from the slate's own
 * games, so the grader can never wait forever on data that never arrives. For a
 * game played in 2018 the risk is not grading, it is generation — so the rule
 * is applied one step earlier and comes out strictly stronger:
 *
 *   **A question is minted only if its answer is computable from rows already
 *   in the database, and the answer is stored with it.**
 *
 * There is therefore no pending state, no settler returning null, and no
 * re-grade. A corrected poll row landing six months from now cannot restate an
 * answer somebody was already scored against.
 *
 * ## What this game cannot promise
 *
 * It names the game, so every fact about it is public: `games`,
 * `line_snapshots` and `poll_rankings` are all anon-readable (migration 0011),
 * and more decisively the answers are on the open internet. Hiding the score
 * from the payload is worth doing — the page should not hand it over — but
 * this is **not** Guess the Game's anti-spoiler property and must not be
 * described as one. That contract worked because the game's IDENTITY was
 * hidden; once the fixture is named, looking it up is the same as not playing,
 * and that is a social contract rather than a technical one.
 */

import { EMPTY_DAILY, recordDayResult, type DailyStats } from "./daily-stats";

export const TAPE_QUESTIONS = 5;

export type TapeKind =
  | "winner"
  | "favourite"
  | "spread_band"
  | "total"
  | "home_ranked"
  | "margin_band"
  | "combined_band"
  | "conference_game"
  | "thirty_plus";

/**
 * Everything a question can be built from. Market and poll fields are nullable
 * because the archive genuinely has holes — an FCS buy game carries no line,
 * week 0 has no poll — and `canAsk` is what keeps a hole from becoming a
 * question nobody can answer.
 */
export interface TapeCtx {
  homeSchool: string;
  awaySchool: string;
  homePoints: number;
  awayPoints: number;
  season: number;
  week: number;
  seasonType: string;
  neutralSite: boolean;
  conferenceGame: boolean;
  /** Closing spread, home perspective, negative = home favoured. */
  spread: number | null;
  total: number | null;
  /** Whether a poll was PUBLISHED that week — not whether anyone was ranked. */
  pollPublished: boolean;
  homeRank: number | null;
}

export const SPREAD_BANDS = ["1–3", "3.5–7", "7.5–14", "14+"] as const;
export const MARGIN_BANDS = ["1–7", "8–14", "15+"] as const;
export const COMBINED_BANDS = ["Under 40", "40–59", "60+"] as const;

/**
 * Which band a number of points falls in. Shaped like `marginBucket` in
 * `six-pack.ts` on purpose — a second vocabulary for "how big was it" across
 * two games in the same arcade is a way to make both harder to read.
 */
export function spreadBand(spread: number): (typeof SPREAD_BANDS)[number] {
  const s = Math.abs(spread);
  if (s <= 3) return "1–3";
  if (s <= 7) return "3.5–7";
  if (s <= 14) return "7.5–14";
  return "14+";
}

export function marginBand(margin: number): (typeof MARGIN_BANDS)[number] {
  const m = Math.abs(margin);
  if (m <= 7) return "1–7";
  if (m <= 14) return "8–14";
  return "15+";
}

/** Combined points, for the reserve question a bare final score can answer. */
export function combinedBand(total: number): (typeof COMBINED_BANDS)[number] {
  if (total < 40) return "Under 40";
  if (total < 60) return "40–59";
  return "60+";
}

/** A usable line: present, and not a pick'em (which has no favourite). */
function hasFavourite(ctx: TapeCtx): boolean {
  return ctx.spread !== null && ctx.spread !== 0;
}

/**
 * Whether this game can support this question.
 *
 * The two subtle ones:
 *
 * - **`total`** also requires the actual total to differ from the line. A game
 *   that landed exactly on the number is a push, and "over or under" has no
 *   true answer — six-pack voids that case, and a round with no void slot has
 *   to refuse it instead.
 * - **`home_ranked`** requires a poll to have been PUBLISHED that week, not
 *   merely that we found no rank. Week 0 and any season we never backfilled
 *   have no poll at all, and answering "no" there states a fact nobody
 *   checked.
 */
export function canAsk(kind: TapeKind, ctx: TapeCtx): boolean {
  switch (kind) {
    case "winner":
      return ctx.homePoints !== ctx.awayPoints;
    case "favourite":
    case "spread_band":
      return hasFavourite(ctx);
    case "total":
      return ctx.total !== null && ctx.homePoints + ctx.awayPoints !== ctx.total;
    case "home_ranked":
      return ctx.pollPublished;
    case "margin_band":
      return ctx.homePoints !== ctx.awayPoints;
    case "combined_band":
    case "conference_game":
    case "thirty_plus":
      return true;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export interface TapeQuestion {
  kind: TapeKind;
  prompt: string;
  choices: string[];
  answer: string;
}

/**
 * One question, worded and answered.
 *
 * Throws rather than returning a degenerate question when `canAsk` is false.
 * A caller that skipped the check has a bug, and a question with a made-up
 * answer is the one failure mode this whole design exists to prevent.
 */
export function askTape(kind: TapeKind, ctx: TapeCtx): TapeQuestion {
  if (!canAsk(kind, ctx)) throw new Error(`tape: cannot ask "${kind}" of this game`);

  const margin = ctx.homePoints - ctx.awayPoints;
  const total = ctx.homePoints + ctx.awayPoints;
  const homeFavoured = ctx.spread !== null && ctx.spread < 0;

  switch (kind) {
    case "winner":
      return {
        kind,
        prompt: "Who won?",
        choices: [ctx.homeSchool, ctx.awaySchool],
        answer: margin > 0 ? ctx.homeSchool : ctx.awaySchool,
      };
    case "favourite":
      return {
        kind,
        prompt: "Who was favoured?",
        choices: [ctx.homeSchool, ctx.awaySchool],
        answer: homeFavoured ? ctx.homeSchool : ctx.awaySchool,
      };
    case "spread_band":
      return {
        kind,
        prompt: "By how much?",
        choices: [...SPREAD_BANDS],
        answer: spreadBand(ctx.spread as number),
      };
    case "total":
      return {
        kind,
        prompt: `Over or under ${ctx.total}?`,
        choices: ["Over", "Under"],
        answer: total > (ctx.total as number) ? "Over" : "Under",
      };
    case "home_ranked":
      return {
        kind,
        prompt: `Was ${ctx.homeSchool} ranked that week?`,
        choices: ["Yes", "No"],
        answer: ctx.homeRank !== null ? "Yes" : "No",
      };
    case "margin_band":
      return {
        kind,
        prompt: "How close was it?",
        choices: [...MARGIN_BANDS],
        answer: marginBand(margin),
      };
    case "combined_band":
      return {
        kind,
        prompt: "How many points, both sides?",
        choices: [...COMBINED_BANDS],
        answer: combinedBand(total),
      };
    case "conference_game":
      return {
        kind,
        prompt: "Conference game?",
        choices: ["Yes", "No"],
        answer: ctx.conferenceGame ? "Yes" : "No",
      };
    case "thirty_plus":
      return {
        kind,
        prompt: "Did either side reach 30?",
        choices: ["Yes", "No"],
        answer: ctx.homePoints >= 30 || ctx.awayPoints >= 30 ? "Yes" : "No",
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * The order questions are offered in.
 *
 * The first five are the round the game is designed around — the winner, then
 * the market, then a poll question that is pure recall. The rest are RESERVES
 * and settle from a final score alone, so they are always askable.
 *
 * The deck filter should mean the reserves are never reached. They exist so
 * that "a round is always five questions" is a property of the code rather
 * than a property of the deck query being right — the same belt-and-braces
 * `submit_six_pack` applies when it refuses a slate its own generator claims
 * cannot exist.
 */
export const TAPE_PRIORITY: readonly TapeKind[] = [
  "winner",
  "favourite",
  "spread_band",
  "total",
  "home_ranked",
  "margin_band",
  "combined_band",
  "conference_game",
  "thirty_plus",
];

/**
 * Whether a game can carry the round the game is designed around — all five
 * headline questions, not five questions of any kind.
 *
 * Kept separate from `salienceScore` for the reason recorded there: ranking and
 * eligibility answer different questions, and a game that both scored zero and
 * vanished would be indistinguishable from one that was merely dull.
 */
export function tapeEligible(ctx: TapeCtx): boolean {
  return TAPE_PRIORITY.slice(0, TAPE_QUESTIONS).every((k) => canAsk(k, ctx));
}

/**
 * The day's five questions, in order. Throws if the game cannot carry five —
 * a four-question round would break the 0–5 score, the five-square share row
 * and the clean-sheet streak all at once, so it is never written.
 */
export function buildTape(ctx: TapeCtx): TapeQuestion[] {
  const out: TapeQuestion[] = [];
  for (const kind of TAPE_PRIORITY) {
    if (out.length === TAPE_QUESTIONS) break;
    if (canAsk(kind, ctx)) out.push(askTape(kind, ctx));
  }
  if (out.length < TAPE_QUESTIONS) {
    throw new Error(`tape: only ${out.length} askable questions for this game`);
  }
  return out;
}

/* ---- the payload -------------------------------------------------------- */

export interface TapeAnswer {
  idx: number;
  choice: string;
  correct: boolean;
}

export interface TapeRowState {
  answers: TapeAnswer[];
  completed_at: string | null;
}

export interface TapeFixture {
  season: number;
  week: number;
  seasonType: string;
  neutralSite: boolean;
  homeSchool: string;
  awaySchool: string;
  homeTeamId: number;
  awayTeamId: number;
  /** The final. Held back from the payload until the round is over. */
  homePoints: number;
  awayPoints: number;
}

/**
 * Everything the client may see, in one place so a test can pin the contract.
 *
 * Copied field by field rather than spread, the discipline `gtgPayload`
 * established: a column added to the stored row must not be able to reach the
 * client by accident. Two gates do the work —
 *
 *  - **`current`** is the one unanswered question. Shipping the whole list
 *    would let a player read question five before answering question one, and
 *    the chain between them is most of what makes the round interesting.
 *  - **`bug`** fills in as facts are settled and the numerals arrive only on
 *    `done`. Both numerals hang off that single condition, so a later edit
 *    cannot reveal one while withholding the other.
 */
export function tapePayload(
  day: string,
  fixture: TapeFixture,
  questions: TapeQuestion[],
  row: TapeRowState,
  stats: DailyStats = EMPTY_DAILY,
) {
  const answered = row.answers.length;
  const done = answered >= TAPE_QUESTIONS;
  const correct = row.answers.filter((a) => a.correct).length;

  /* The winner is a settled fact the moment question one is answered — the
     history row already names it — so the bug may show it. Anything the
     history has not given away yet stays null. */
  const winnerIdx = questions.findIndex((q) => q.kind === "winner");
  const winner =
    winnerIdx >= 0 && answered > winnerIdx ? (questions[winnerIdx]!.answer ?? null) : null;

  return {
    day,
    fixture: {
      season: fixture.season,
      week: fixture.week,
      seasonType: fixture.seasonType,
      neutralSite: fixture.neutralSite,
      homeSchool: fixture.homeSchool,
      awaySchool: fixture.awaySchool,
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
    },
    answered,
    total: TAPE_QUESTIONS,
    current:
      done || questions[answered] === undefined
        ? null
        : {
            idx: answered,
            prompt: questions[answered]!.prompt,
            choices: [...questions[answered]!.choices],
          },
    history: row.answers.map((a) => ({
      idx: a.idx,
      prompt: questions[a.idx]?.prompt ?? "",
      yours: a.choice,
      answer: questions[a.idx]?.answer ?? "",
      correct: a.correct,
    })),
    /* The scoreboard fills in as facts settle. The NUMERALS are the last thing
       to arrive and both hang off the single `done` condition — one gate, both
       fields, so a later edit cannot reveal one while withholding the other.
       That is `gtgPayload`'s rule for `answer`/`answerTeams`, and it is the
       reason that pair never drifted apart. */
    bug: {
      winner,
      homePoints: done ? fixture.homePoints : null,
      awayPoints: done ? fixture.awayPoints : null,
    },
    done,
    correct: done ? correct : null,
    stats,
  };
}

/** 1 a correct answer, plus a bonus for the clean sheet. */
export const TAPE_POINTS = { correct: 1, cleanSheet: 3 } as const;

export function tapeScore(answers: TapeAnswer[]): number {
  const correct = answers.filter((a) => a.correct).length;
  const clean = answers.length >= TAPE_QUESTIONS && correct === TAPE_QUESTIONS;
  return correct * TAPE_POINTS.correct + (clean ? TAPE_POINTS.cleanSheet : 0);
}

const CELL = { hit: "🟩", miss: "⬛" } as const;

/**
 * Spoiler-free for somebody who has not played: no school names, no score, no
 * question wording. One row of five, in the order they were asked, so two
 * people who both went 4/5 can see they missed different ones.
 */
export function tapeShareBlock(
  day: string,
  answers: TapeAnswer[],
  streak = 0,
): string {
  const correct = answers.filter((a) => a.correct).length;
  const grid = answers.map((a) => (a.correct ? CELL.hit : CELL.miss)).join("");
  const footer = streak > 0 ? `\nStreak ${streak}` : "";
  return `The Tape · ${day} · ${correct}/${TAPE_QUESTIONS}\n${grid}${footer}`;
}

/** A finished day, folded. A clean sheet extends the streak; anything else ends it. */
export function tapeStanding(
  rows: Array<{ day: string; correct: number }>,
): DailyStats {
  return [...rows]
    .sort((a, b) => a.day.localeCompare(b.day))
    .reduce(
      (acc, r) => recordDayResult(acc, r.day, r.correct === TAPE_QUESTIONS, r.correct),
      EMPTY_DAILY,
    );
}

/**
 * The Games hub (R3-E1): every game, with what you owe it today.
 *
 * Split pure/IO the way `home.ts` is: `gamesHubRows` turns raw state into the
 * row copy and the ordering with no database in sight, so the words on the
 * page are unit-tested; `fetchGamesHub` is the reads.
 *
 * The ordering rule is the whole design: **anything outstanding first**, so
 * the first thumb target is the thing you have not done. Everything else
 * keeps a fixed order, because a list that reshuffles for reasons the reader
 * cannot see is worse than one that is occasionally stale.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { productDate, streakFold, type StreakPickLike } from "./streak";

export type GameId = "guess-lines" | "streak" | "guess-game" | "six-pack" | "tape" | "chains";

export interface GamesHubState {
  /** Guess the Lines: this week's slate, and how much of it you've called. */
  lines: { open: number; mine: number; meanError: number | null };
  /** The Streak: whether today has a matchup, whether you're in, and your run. */
  streak: { hasToday: boolean; pickedToday: boolean; current: number; best: number };
  /** Guess the Game: today's attempt state. */
  gtg: { attempts: number; solved: boolean; played: boolean };
  /** The Six-Pack: this week's entry (R3-E2 fills it; zeros until then). */
  sixPack: { open: boolean; entered: boolean; correct: number | null };
  /** The Tape: whether there is a round today, and how far you got. */
  tape: { hasToday: boolean; answered: number; done: boolean; correct: number | null };
  /** Chains: whether there is a run today, and how long yours got. */
  chains: { hasToday: boolean; length: number; done: boolean };
  signedIn: boolean;
}

export interface GamesHubRow {
  id: GameId;
  href: string;
  name: string;
  blurb: string;
  /** Right-hand state line. Never empty — say "Not played" rather than blank. */
  state: string;
  /** True when the viewer owes this game an action today. */
  outstanding: boolean;
}

export const EMPTY_HUB_STATE: GamesHubState = {
  lines: { open: 0, mine: 0, meanError: null },
  streak: { hasToday: false, pickedToday: false, current: 0, best: 0 },
  gtg: { attempts: 0, solved: false, played: false },
  sixPack: { open: false, entered: false, correct: null },
  tape: { hasToday: false, answered: 0, done: false, correct: null },
  chains: { hasToday: false, length: 0, done: false },
  signedIn: false,
};

/** Fixed order once outstanding-ness ties: daily games first, weekly last. */
const ORDER: GameId[] = ["streak", "tape", "chains", "guess-game", "guess-lines", "six-pack"];

export function gamesHubRows(s: GamesHubState): GamesHubRow[] {
  const slateSize = s.lines.open + s.lines.mine;
  const rows: GamesHubRow[] = [
    {
      id: "streak",
      href: "/streak",
      name: "The Streak",
      blurb: "One matchup a day, straight up. A miss resets the run.",
      state: !s.streak.hasToday
        ? "No matchup today"
        : s.streak.pickedToday
          ? `In · ${s.streak.current} in a row`
          : `${s.streak.current} in a row · best ${s.streak.best}`,
      outstanding: s.signedIn && s.streak.hasToday && !s.streak.pickedToday,
    },
    {
      id: "guess-game",
      href: "/guess-game",
      name: "Guess the Game",
      blurb: "One game from the archives. Six guesses, a clue per miss.",
      state: s.gtg.solved
        ? `Solved in ${s.gtg.attempts}`
        : s.gtg.played
          ? `${s.gtg.attempts} of 6 used`
          : "Not played",
      outstanding: s.signedIn && !s.gtg.solved && s.gtg.attempts < 6,
    },
    {
      id: "tape",
      href: "/tape",
      name: "The Tape",
      blurb: "One game from the archive. We name it; you say what happened.",
      state: !s.tape.hasToday
        ? "No round today"
        : s.tape.done
          ? `${s.tape.correct} of 5`
          : s.tape.answered > 0
            ? `${s.tape.answered} of 5 answered`
            : "Not played",
      outstanding: s.signedIn && s.tape.hasToday && !s.tape.done,
    },
    {
      id: "chains",
      href: "/chains",
      name: "Chains",
      blurb: "Two games, one question. Keep calling them until you miss.",
      state: !s.chains.hasToday
        ? "No run today"
        : s.chains.done
          ? `${s.chains.length} in a row`
          : s.chains.length > 0
            ? `${s.chains.length} and running`
            : "Not played",
      outstanding: s.signedIn && s.chains.hasToday && !s.chains.done,
    },
    {
      id: "guess-lines",
      href: "/guess-lines",
      name: "Guess the Lines",
      blurb: "Call the spread before the books hang one.",
      state:
        slateSize === 0
          ? "No slate yet"
          : `${s.lines.mine} of ${slateSize} in${
              s.lines.meanError === null ? "" : ` · off by ${s.lines.meanError.toFixed(1)} avg`
            }`,
      outstanding: s.signedIn && s.lines.open > 0,
    },
    {
      id: "six-pack",
      href: "/six-pack",
      name: "The Six-Pack",
      blurb: "Six questions on the week. Clear all six for the crown.",
      state: !s.sixPack.open
        ? "No slate yet"
        : s.sixPack.entered
          ? s.sixPack.correct === null
            ? "Entered · locks at kickoff"
            : `${s.sixPack.correct} correct`
          : "Open",
      outstanding: s.signedIn && s.sixPack.open && !s.sixPack.entered,
    },
  ];

  const rank = (r: GamesHubRow) => ORDER.indexOf(r.id);
  return rows.sort(
    (a, b) => Number(b.outstanding) - Number(a.outstanding) || rank(a) - rank(b),
  );
}

/* ---- the IO half -------------------------------------------------------- */

/**
 * The viewer's own state across every game. Own rows only — RLS already
 * scopes these to the caller, and the hub is about what YOU owe, not about
 * anyone's leaderboard (that lives on each game's page, scoped by the pool
 * picker). A missing table — a deploy that outran a migration — comes back as
 * null data and reads as "no slate yet", which is the honest degradation.
 */
export async function fetchGamesHub(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<GamesHubState> {
  const today = productDate(new Date());

  const [
    slateRes,
    myGuessRes,
    streakDayRes,
    myStreakRes,
    gtgRes,
    sixPackRes,
    tapeDayRes,
    tapeMineRes,
    chainsDayRes,
    chainsMineRes,
  ] = await Promise.all([
    supabase.from("guess_line_slates").select("game_id"),
    userId
      ? supabase.from("line_guesses").select("game_id, abs_error").eq("user_id", userId)
      : Promise.resolve({ data: [] }),
    supabase.from("streak_days").select("day").eq("day", today).maybeSingle(),
    userId
      ? supabase.from("streak_picks").select("day, result").eq("user_id", userId)
      : Promise.resolve({ data: [] }),
    userId
      ? supabase
          .from("gtg_guesses")
          .select("attempts, solved_at")
          .eq("user_id", userId)
          .eq("day", today)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // The newest slate (R3-E2). A missing table — a deploy ahead of migration
    // 0062 — comes back as null and reads as "no slate yet". Plain reads
    // rather than a PostgREST embed: the entries need the viewer's own rows
    // only, and an embed would pull everyone's for RLS to trim.
    supabase
      .from("six_pack_slates")
      .select("id, week")
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // TAPE-2. A missing table — a deploy ahead of migration 0068 — comes back
    // as null and reads as "no round today", the same honest degradation the
    // six-pack read above relies on.
    supabase.from("tape_puzzles").select("day").eq("day", today).maybeSingle(),
    userId
      ? supabase
          .from("tape_entries")
          .select("answers, correct, completed_at")
          .eq("user_id", userId)
          .eq("day", today)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // CHAIN-2, same honest degradation as the two reads above.
    supabase.from("chains_puzzles").select("day").eq("day", today).maybeSingle(),
    userId
      ? supabase
          .from("chains_runs")
          .select("length, ended_at")
          .eq("user_id", userId)
          .eq("day", today)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const sixPackSlate = (sixPackRes?.data ?? null) as { id: number; week: number } | null;
  const [myEntriesRes, questionCountRes] = sixPackSlate
    ? await Promise.all([
        userId
          ? supabase
              .from("six_pack_entries")
              .select("idx, result")
              .eq("slate_id", sixPackSlate.id)
              .eq("user_id", userId)
          : Promise.resolve({ data: [] }),
        supabase.from("six_pack_questions").select("idx").eq("slate_id", sixPackSlate.id),
      ])
    : [{ data: [] }, { data: [] }];
  const myEntries = (myEntriesRes.data ?? []) as Array<{
    idx: number;
    result: "correct" | "wrong" | "void" | null;
  }>;
  const questionCount = ((questionCountRes.data ?? []) as Array<{ idx: number }>).length;
  const gradedCorrect = myEntries.filter((e) => e.result === "correct").length;
  const anyGraded = myEntries.some((e) => e.result !== null);

  const slateIds = new Set(
    ((slateRes.data ?? []) as Array<{ game_id: number }>).map((r) => r.game_id),
  );
  const myGuesses = (myGuessRes.data ?? []) as Array<{
    game_id: number;
    abs_error: number | null;
  }>;
  const onSlate = myGuesses.filter((g) => slateIds.has(g.game_id));
  const graded = myGuesses.filter((g) => g.abs_error !== null);
  const meanError =
    graded.length === 0
      ? null
      : graded.reduce((t, g) => t + Number(g.abs_error), 0) / graded.length;

  const myStreak = (myStreakRes.data ?? []) as StreakPickLike[];
  const fold = streakFold(myStreak);
  const gtg = (gtgRes.data ?? null) as { attempts: number; solved_at: string | null } | null;
  const tape = (tapeMineRes?.data ?? null) as {
    answers: unknown[];
    correct: number;
    completed_at: string | null;
  } | null;
  const chains = (chainsMineRes?.data ?? null) as {
    length: number;
    ended_at: string | null;
  } | null;

  return {
    lines: {
      open: Math.max(0, slateIds.size - onSlate.length),
      mine: onSlate.length,
      meanError,
    },
    streak: {
      hasToday: streakDayRes.data != null,
      pickedToday: myStreak.some((p) => p.day === today),
      current: fold.current,
      best: fold.best,
    },
    gtg: {
      attempts: gtg?.attempts ?? 0,
      solved: gtg?.solved_at != null,
      played: gtg != null,
    },
    tape: {
      hasToday: tapeDayRes?.data != null,
      answered: tape?.answers?.length ?? 0,
      done: tape?.completed_at != null,
      correct: tape?.completed_at != null ? tape.correct : null,
    },
    chains: {
      hasToday: chainsDayRes?.data != null,
      length: chains?.length ?? 0,
      done: chains?.ended_at != null,
    },
    sixPack: {
      open: questionCount > 0,
      entered: myEntries.length > 0,
      correct: anyGraded ? gradedCorrect : null,
    },
    signedIn: userId !== null,
  };
}

import { cookies } from "next/headers";
import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { GamesScopePicker } from "../../components/games/GamesScopePicker";
import { SixPackForm, type SixPackFormQuestion } from "../../components/SixPackForm";
import {
  GAMES_SCOPE_COOKIE,
  resolveGameScope,
  scopeLabel,
  scopeParam,
  scopeRoster,
} from "../../lib/games-scope";
import { ACTIVE_GROUP_COOKIE, fetchMyGroups } from "../../lib/groups";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import {
  choiceText,
  entryScore,
  questionText,
  rolloverWeeks,
  type SixPackKind,
  type SixPackQuestion,
} from "../../lib/six-pack";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "The Six-Pack" };

interface QuestionRow {
  slate_id: number;
  idx: number;
  kind: SixPackKind;
  game_id: number | null;
  line: number | null;
  choices: string[];
  answer: string | null;
  graded_at: string | null;
}

/**
 * The Six-Pack (R3-E2): six questions on the week, free to play, scored in
 * points. Answers are hidden until the first kickoff, then everyone's board
 * opens — the shape Guess the Lines and the pick'em blind already use.
 *
 * The rollover ("nobody's cleared it in four weeks") is DERIVED here from
 * graded slates, never stored, so a re-grade moves it. It is a counter and a
 * name, not a pot — BRAND §16.
 */
export default async function SixPackPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const { g: groupParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const jar = await cookies();
  const remembered =
    jar.get(GAMES_SCOPE_COOKIE)?.value ?? jar.get(ACTIVE_GROUP_COOKIE)?.value ?? null;
  const myGroups = await fetchMyGroups(supabase, user?.id ?? null);
  const scope = resolveGameScope(myGroups, groupParam ?? null, remembered);

  const { seasonId, week, seasonType } = await fetchCurrentSeasonWeek(supabase);
  const { data: slateRow } = await supabase
    .from("six_pack_slates")
    .select("id, week")
    .eq("season_id", seasonId)
    .eq("season_type", seasonType)
    .eq("week", week)
    .maybeSingle();
  const slate = slateRow as { id: number; week: number } | null;

  const [questionsRes, entriesRes, roster, allSlatesRes] = await Promise.all([
    slate
      ? supabase
          .from("six_pack_questions")
          .select("slate_id, idx, kind, game_id, line, choices, answer, graded_at")
          .eq("slate_id", slate.id)
          .order("idx", { ascending: true })
      : Promise.resolve({ data: [] }),
    slate
      ? supabase
          .from("six_pack_entries")
          .select("user_id, slate_id, idx, choice, result")
          .eq("slate_id", slate.id)
      : Promise.resolve({ data: [] }),
    scopeRoster(supabase, scope),
    // Every graded slate this season, for the rollover fold.
    supabase
      .from("six_pack_slates")
      .select("id, week")
      .eq("season_id", seasonId)
      .eq("season_type", seasonType),
  ]);

  const questions = (questionsRes.data ?? []) as QuestionRow[];
  const entries = (entriesRes.data ?? []) as Array<{
    user_id: string;
    slate_id: number;
    idx: number;
    choice: string;
    result: "correct" | "wrong" | "void" | null;
  }>;
  const { userIds, nameById } = roster;
  const inScope = (uid: string) => userIds === null || userIds.includes(uid);

  // Team labels for every game the questions name.
  const gameIds = [
    ...new Set([
      ...questions.map((q) => q.game_id).filter((id): id is number => id !== null),
      ...questions.flatMap((q) => (q.kind === "high_game" ? q.choices.map(Number) : [])),
    ]),
  ];
  const { data: gameRows } = gameIds.length
    ? await supabase
        .from("games")
        .select("id, home_team_id, away_team_id, start_ts")
        .in("id", gameIds)
    : { data: [] };
  const games = (gameRows ?? []) as Array<{
    id: number;
    home_team_id: number;
    away_team_id: number;
    start_ts: string | null;
  }>;
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: teamRows } = teamIds.length
    ? await supabase.from("teams").select("id, school, abbreviation").in("id", teamIds)
    : { data: [] };
  const abbr = new Map(
    ((teamRows ?? []) as Array<{ id: number; school: string; abbreviation: string | null }>).map(
      (t) => [t.id, t.abbreviation ?? t.school],
    ),
  );
  const labelsFor = (gameId: number) => {
    const g = games.find((x) => x.id === gameId);
    if (!g) return null;
    return { home: abbr.get(g.home_team_id) ?? "Home", away: abbr.get(g.away_team_id) ?? "Away" };
  };

  const toPure = (q: QuestionRow): SixPackQuestion => ({
    idx: q.idx,
    kind: q.kind,
    gameId: q.game_id,
    line: q.line === null ? null : Number(q.line),
    choices: q.choices,
    answer: q.answer,
  });

  // The lock, derived: the earliest kickoff among the games this slate names.
  // TBD counts as locked, the same fail-closed rule the RPC applies.
  // One clock read for the whole render, like the streak page — the lock and
  // anything else time-dependent must agree with each other.
  const nowMs = new Date().getTime();
  const kickoffs = questions
    .map((q) => q.game_id)
    .filter((id): id is number => id !== null)
    .map((id) => games.find((g) => g.id === id)?.start_ts ?? null);
  const locked =
    kickoffs.length === 0 || kickoffs.some((ts) => ts === null || Date.parse(ts) <= nowMs);

  const mine: Record<number, string> = {};
  if (user) {
    for (const e of entries) if (e.user_id === user.id) mine[e.idx] = e.choice;
  }

  const formQuestions: SixPackFormQuestion[] = questions.map((q) => ({
    idx: q.idx,
    text: questionText(toPure(q), q.game_id === null ? null : labelsFor(q.game_id)),
    choices: q.choices.map((c) => ({
      value: c,
      label: choiceText(toPure(q), c, labelsFor),
    })),
  }));

  // The board: everyone in scope who entered, once the slate reveals.
  const byUser = new Map<string, Array<{ idx: number; choice: string; result: typeof entries[number]["result"] }>>();
  for (const e of entries) {
    if (!inScope(e.user_id)) continue;
    const arr = byUser.get(e.user_id) ?? [];
    arr.push({ idx: e.idx, choice: e.choice, result: e.result });
    byUser.set(e.user_id, arr);
  }
  const board = [...byUser.entries()]
    .map(([uid, lines]) => ({ name: nameById.get(uid) ?? "?", ...entryScore(lines) }))
    .sort((a, b) => b.correct - a.correct || b.gradable - a.gradable || a.name.localeCompare(b.name));

  // The rollover, derived from graded weeks: how long since anyone cleared it.
  const seasonSlates = (allSlatesRes.data ?? []) as Array<{ id: number; week: number }>;
  const { data: allEntryRows } = seasonSlates.length
    ? await supabase
        .from("six_pack_entries")
        .select("user_id, slate_id, idx, result")
        .in("slate_id", seasonSlates.map((s) => s.id))
    : { data: [] };
  const seasonEntries = (allEntryRows ?? []) as Array<{
    user_id: string;
    slate_id: number;
    idx: number;
    result: "correct" | "wrong" | "void" | null;
  }>;
  const weekFolds = seasonSlates.map((s) => {
    const rows = seasonEntries.filter((e) => e.slate_id === s.id && inScope(e.user_id));
    const perUser = new Map<string, typeof rows>();
    for (const r of rows) perUser.set(r.user_id, [...(perUser.get(r.user_id) ?? []), r]);
    const scores = [...perUser.values()].map((lines) =>
      entryScore(lines.map((l) => ({ idx: l.idx, choice: "", result: l.result }))),
    );
    return {
      week: s.week,
      anyPerfect: scores.some((sc) => sc.perfect),
      complete: scores.length > 0 && scores.every((sc) => sc.pending === 0),
    };
  });
  const rollover = rolloverWeeks(weekFolds);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl">The Six-Pack</h1>
          <Link href="/games" className="stat text-xs text-dim hover:text-chalk">
            ← Games
          </Link>
        </div>
        <p className="mb-4 text-sm text-dim">
          Six questions on the week, free to play. Answers lock at the first kickoff and stay
          hidden until then.
          {rollover > 0 && (
            <>
              {" "}
              <span className="text-chalk">
                Nobody in {scopeLabel(scope)} has cleared it in {rollover}{" "}
                {rollover === 1 ? "week" : "weeks"}.
              </span>
            </>
          )}
        </p>

        {user && (
          <GamesScopePicker
            groups={myGroups.map((m) => ({ slug: m.slug, name: m.name }))}
            activeParam={scopeParam(scope)}
          />
        )}

        {questions.length === 0 ? (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">No six-pack this week yet</p>
            <p className="mt-1 text-sm text-dim">
              The week&rsquo;s six questions are set on Tuesday, once the lines are up.
            </p>
          </div>
        ) : (
          <section className="card mb-4 p-4">
            <h2 className="mb-3 text-sm text-accent">Week {slate?.week} — six questions</h2>
            {user ? (
              <SixPackForm
                slateId={slate!.id}
                questions={formQuestions}
                mine={mine}
                locked={locked}
              />
            ) : (
              <>
                <ul className="mb-3 flex flex-col gap-1.5">
                  {formQuestions.map((q) => (
                    <li key={q.idx} className="text-sm text-chalk">
                      <span className="stat mr-2 text-[10px] uppercase tracking-wider text-chalk/45">
                        {q.idx}
                      </span>
                      {q.text}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-dim">
                  <Link href="/login" className="text-accent underline-offset-2 hover:underline">
                    Sign in
                  </Link>{" "}
                  to enter.
                </p>
              </>
            )}
          </section>
        )}

        {board.length > 0 && (
          <section className="card p-4">
            <h2 className="mb-2 text-sm text-accent">The board — {scopeLabel(scope)}</h2>
            <ul className="flex flex-col gap-1">
              {board.map((b) => (
                <li key={b.name} className="stat flex items-center justify-between text-sm">
                  <span className="font-sans text-chalk">{b.name}</span>
                  <span className="text-dim">
                    {b.gradable === 0
                      ? "entered"
                      : `${b.correct}/${b.gradable}${b.perfect ? " · cleared it" : ""}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

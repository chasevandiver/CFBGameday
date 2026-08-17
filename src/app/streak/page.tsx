import { cookies } from "next/headers";
import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { GamesScopePicker } from "../../components/games/GamesScopePicker";
import { StreakCard } from "../../components/StreakCard";
import {
  GAMES_SCOPE_COOKIE,
  resolveGameScope,
  scopeLabel,
  scopeParam,
  scopeRoster,
} from "../../lib/games-scope";
import { ACTIVE_GROUP_COOKIE, fetchMyGroups } from "../../lib/groups";
import { productDate, streakFold, type StreakPickLike } from "../../lib/streak";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "The Streak" };

/**
 * The year-round one (R2-C2): one curated matchup a day, straight up, either
 * league. The streak is the whole currency — a losable thing people come
 * back to protect. Derived from graded picks on every read, never stored.
 * A day with no matchup is dormant, not broken.
 */
export default async function StreakPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const { g: groupParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // One clock read for the whole render — the day label and the lock check
  // must agree with each other (react-hooks/purity flags a second read).
  const now = new Date();
  const today = productDate(now);
  const jar = await cookies();
  const remembered =
    jar.get(GAMES_SCOPE_COOKIE)?.value ?? jar.get(ACTIVE_GROUP_COOKIE)?.value ?? null;
  const mine = await fetchMyGroups(supabase, user?.id ?? null);
  const scope = resolveGameScope(mine, groupParam ?? null, remembered);

  const [{ data: dayRow }, picksRes, roster] = await Promise.all([
    supabase.from("streak_days").select("day, game_id").eq("day", today).maybeSingle(),
    // RLS: own always, others post-kickoff. Graded history feeds the board.
    supabase.from("streak_picks").select("user_id, day, side, result"),
    scopeRoster(supabase, scope),
  ]);

  const { userIds, nameById } = roster;
  const allPicks = (picksRes.data ?? []) as Array<{
    user_id: string;
    day: string;
    side: "home" | "away";
    result: "win" | "loss" | "void" | null;
  }>;
  // The pool filter (R3-E1). A product filter over rows RLS already allows —
  // never a security boundary. `userIds === null` is the everyone view and
  // takes the unfiltered path this page always had.
  const picks = userIds === null ? allPicks : allPicks.filter((p) => userIds.includes(p.user_id));

  // Today's matchup, if the job selected one.
  let matchup: {
    day: string;
    homeLabel: string;
    awayLabel: string;
    locked: boolean;
    startTs: string | null;
  } | null = null;
  if (dayRow) {
    const { data: game } = await supabase
      .from("games")
      .select("id, home_team_id, away_team_id, start_ts, status")
      .eq("id", (dayRow as { game_id: number }).game_id)
      .maybeSingle();
    if (game) {
      const { data: teamRows } = await supabase
        .from("teams")
        .select("id, school, abbreviation")
        .in("id", [game.home_team_id, game.away_team_id]);
      const label = new Map(
        ((teamRows ?? []) as Array<{ id: number; school: string; abbreviation: string | null }>).map(
          (t) => [t.id, t.abbreviation ?? t.school],
        ),
      );
      matchup = {
        day: today,
        homeLabel: label.get(game.home_team_id) ?? "Home",
        awayLabel: label.get(game.away_team_id) ?? "Away",
        // TBD kickoff renders locked — the RPC refuses it anyway.
        locked:
          game.status !== "scheduled" ||
          game.start_ts === null ||
          Date.parse(game.start_ts) <= now.getTime(),
        startTs: game.start_ts,
      };
    }
  }
  const myToday = user
    ? (picks.find((p) => p.user_id === user.id && p.day === today)?.side ?? null)
    : null;

  // The board: fold every member's history. Pending days pass through.
  const byUser = new Map<string, StreakPickLike[]>();
  for (const p of picks) {
    const arr = byUser.get(p.user_id) ?? [];
    arr.push({ day: p.day, result: p.result });
    byUser.set(p.user_id, arr);
  }
  const board = [...byUser.entries()]
    .map(([uid, rows]) => ({ name: nameById.get(uid) ?? "?", ...streakFold(rows) }))
    .filter((b) => b.wins + b.losses > 0 || b.current > 0)
    .sort((a, b) => b.current - a.current || b.best - a.best || b.wins - a.wins);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl">The Streak</h1>
          <Link href="/games" className="stat text-xs text-dim hover:text-chalk">
            ← Games
          </Link>
        </div>
        <p className="mb-4 text-sm text-dim">
          One matchup a day, straight up, either league. Wins build the run; one miss resets it;
          a postponed game or a tie breaks nothing.
        </p>

        {user && (
          <GamesScopePicker
            groups={mine.map((m) => ({ slug: m.slug, name: m.name }))}
            activeParam={scopeParam(scope)}
          />
        )}

        <section className="card mb-4 p-4">
          <h2 className="mb-2 text-sm text-accent">Today</h2>
          {matchup === null ? (
            <p className="text-sm text-dim">
              No matchup today — the streak sleeps when football does.
            </p>
          ) : user ? (
            <StreakCard
              day={matchup.day}
              homeLabel={matchup.homeLabel}
              awayLabel={matchup.awayLabel}
              mySide={myToday}
              locked={matchup.locked}
            />
          ) : (
            <p className="text-sm text-chalk">
              {matchup.awayLabel} @ {matchup.homeLabel} —{" "}
              <Link href="/login" className="text-accent underline-offset-2 hover:underline">
                sign in
              </Link>{" "}
              to play.
            </p>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-2 text-sm text-accent">The board — {scopeLabel(scope)}</h2>
          {board.length === 0 ? (
            <p className="text-sm text-dim">
              {scope.kind === "group"
                ? `Nobody in ${scope.group.name} has played yet.`
                : "Nobody has played yet."}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {board.map((b) => (
                <li key={b.name} className="stat flex items-center justify-between text-sm">
                  <span className="font-sans text-chalk">{b.name}</span>
                  <span className="text-dim">
                    <span className={b.current > 0 ? "font-semibold text-accent" : ""}>
                      {b.current}
                    </span>{" "}
                    now · best {b.best} · {b.wins}-{b.losses}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

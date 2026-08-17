import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { GuessGamePlay } from "../../components/GuessGamePlay";
import { fetchProfiles } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Guess the Game" };

/**
 * The daily puzzle (R2-C3): one game from the 2023–25 backfill, same for
 * everyone, six guesses at the home team, one clue bought per miss. The play
 * itself runs through /api/guess-game so the answer never ships to the
 * client early; this page is the shell and the leaderboard.
 */
export default async function GuessGamePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: boardRows }, profiles] = user
    ? await Promise.all([supabase.rpc("gtg_leaderboard"), fetchProfiles(supabase)])
    : [{ data: [] }, []];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const board = ((boardRows ?? []) as Array<{
    user_id: string;
    solved: number;
    points: number;
    played: number;
  }>)
    .map((r) => ({ name: nameById.get(r.user_id) ?? "?", ...r }))
    .sort((a, b) => b.points - a.points || b.solved - a.solved);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <h1 className="mb-1 text-2xl">Guess the Game</h1>
        <p className="mb-5 text-sm text-dim">
          One game from the archives, every day. Six guesses at the home team; every miss buys a
          clue. Fewer guesses, more points.
        </p>

        {user ? (
          <GuessGamePlay />
        ) : (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">Today&rsquo;s puzzle is waiting</p>
            <p className="mt-1 text-sm text-dim">
              <Link href="/login" className="text-accent underline-offset-2 hover:underline">
                Sign in
              </Link>{" "}
              to play — same game for everyone, no spoilers here.
            </p>
          </div>
        )}

        {board.length > 0 && (
          <section className="card mt-4 p-4">
            <h2 className="mb-2 text-sm text-accent">The board</h2>
            <ul className="flex flex-col gap-1">
              {board.map((b, i) => (
                <li key={b.user_id} className="stat flex items-center justify-between text-sm">
                  <span className="font-sans text-chalk">
                    {i + 1}. {b.name}
                  </span>
                  <span className="text-dim">
                    {b.points} pts · {b.solved}/{b.played} solved
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

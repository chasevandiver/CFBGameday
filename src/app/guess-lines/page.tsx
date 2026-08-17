import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { GuessLineCard } from "../../components/GuessLineCard";
import { openingSpread, SNAPSHOT_COLS, type SnapshotLike } from "../../lib/consensus";
import { fetchCurrentSeasonWeek, fetchProfiles } from "../../lib/queries";
import { fmtSpread } from "../../lib/slate";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Guess the Lines" };

interface SlateGameRow {
  id: number;
  home_team_id: number;
  away_team_id: number;
  start_ts: string | null;
  season_id: number;
  week: number;
}

interface GuessRow {
  user_id: string;
  game_id: number;
  guess: number;
  abs_error: number | null;
  graded_at: string | null;
}

/**
 * The Tuesday ritual (R2-C1): submit your spread before the books hang one;
 * grade against the open; argue. Zero risk, pure status — the season board
 * ranks mean absolute error, "sharpest eye" not "best capper" (BRAND §16).
 *
 * Guessing for a game closes THE MOMENT its first snapshot lands (the RPC
 * enforces it; this page just renders the two states). Others' guesses stay
 * hidden until then — after the reveal, copying is worthless.
 */
export default async function GuessLinesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Both leagues' current weeks; NFL absent is a state, not an error.
  const cfb = await fetchCurrentSeasonWeek(supabase);
  let nfl: { seasonId: number; week: number } | null = null;
  try {
    nfl = await fetchCurrentSeasonWeek(supabase, "nfl");
  } catch {
    /* no NFL season configured */
  }

  const slateFilters = [
    { season_id: cfb.seasonId, week: cfb.week },
    ...(nfl ? [{ season_id: nfl.seasonId, week: nfl.week }] : []),
  ];
  const slateRes = await Promise.all(
    slateFilters.map((f) =>
      supabase
        .from("guess_line_slates")
        .select("game_id, season_id, week")
        .eq("season_id", f.season_id)
        .eq("week", f.week),
    ),
  );
  const slateGameIds = slateRes.flatMap((r) =>
    ((r.data ?? []) as Array<{ game_id: number }>).map((x) => x.game_id),
  );

  const [gamesRes, guessesRes, snapsRes, profiles, seasonGuessRes] = await Promise.all([
    slateGameIds.length
      ? supabase
          .from("games")
          .select("id, home_team_id, away_team_id, start_ts, season_id, week")
          .in("id", slateGameIds)
      : Promise.resolve({ data: [] }),
    slateGameIds.length
      ? supabase
          .from("line_guesses")
          .select("user_id, game_id, guess, abs_error, graded_at")
          .in("game_id", slateGameIds)
      : Promise.resolve({ data: [] }),
    slateGameIds.length
      ? supabase.from("line_snapshots").select(SNAPSHOT_COLS).in("game_id", slateGameIds)
      : Promise.resolve({ data: [] }),
    fetchProfiles(supabase),
    // Season board: every graded guess, either league, this calendar year.
    supabase
      .from("line_guesses")
      .select("user_id, abs_error")
      .not("graded_at", "is", null),
  ]);

  const games = (gamesRes.data ?? []) as SlateGameRow[];
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: teamRows } = teamIds.length
    ? await supabase.from("teams").select("id, school, abbreviation").in("id", teamIds)
    : { data: [] };
  const abbr = new Map(
    ((teamRows ?? []) as Array<{ id: number; school: string; abbreviation: string | null }>).map(
      (t) => [t.id, t.abbreviation ?? t.school],
    ),
  );
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));

  const snapsByGame = new Map<number, SnapshotLike[]>();
  for (const s of (snapsRes.data ?? []) as Array<SnapshotLike & { game_id: number }>) {
    const arr = snapsByGame.get(s.game_id) ?? [];
    arr.push(s);
    snapsByGame.set(s.game_id, arr);
  }
  const guesses = (guessesRes.data ?? []) as GuessRow[];
  const mine = new Map(
    guesses.filter((g) => user && g.user_id === user.id).map((g) => [g.game_id, Number(g.guess)]),
  );

  const label = (g: SlateGameRow) =>
    `${abbr.get(g.away_team_id) ?? "?"} @ ${abbr.get(g.home_team_id) ?? "?"}`;
  const open = games.filter((g) => !snapsByGame.has(g.id));
  const revealed = games.filter((g) => snapsByGame.has(g.id));

  // ---- season board: mean absolute error, most guesses breaking ties ----
  const seasonRows = (seasonGuessRes.data ?? []) as Array<{
    user_id: string;
    abs_error: number | null;
  }>;
  const byUser = new Map<string, { n: number; sum: number }>();
  for (const r of seasonRows) {
    if (r.abs_error === null) continue;
    const t = byUser.get(r.user_id) ?? { n: 0, sum: 0 };
    t.n += 1;
    t.sum += Number(r.abs_error);
    byUser.set(r.user_id, t);
  }
  const board = [...byUser.entries()]
    .map(([uid, t]) => ({ name: nameById.get(uid) ?? "?", n: t.n, mae: t.sum / t.n }))
    .sort((a, b) => a.mae - b.mae || b.n - a.n);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="mb-1 text-2xl">Guess the Lines</h1>
        <p className="mb-5 text-sm text-dim">
          Call the spread before the books hang one. Guesses grade against the opening line and
          close forever the moment a number posts. Season board is mean error — sharpest eye wins.
        </p>

        {games.length === 0 && (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">No slate yet</p>
            <p className="mt-1 text-sm text-dim">
              The week&rsquo;s guessable games are selected Monday, before lines post.
            </p>
          </div>
        )}

        {open.length > 0 && (
          <section className="card mb-4 p-4">
            <h2 className="mb-1 text-sm text-accent">Open — no line yet</h2>
            <p className="mb-2 text-xs text-dim">
              Home-perspective spread: negative means the home team is favored.
            </p>
            {!user && (
              <p className="mb-2 text-xs text-dim">
                <Link href="/login" className="text-accent underline-offset-2 hover:underline">
                  Sign in
                </Link>{" "}
                to play.
              </p>
            )}
            {open.map((g) =>
              user ? (
                <GuessLineCard
                  key={g.id}
                  gameId={g.id}
                  label={label(g)}
                  myGuess={mine.get(g.id) ?? null}
                />
              ) : (
                <p key={g.id} className="border-b border-chalk/5 py-2 text-sm text-chalk last:border-0">
                  {label(g)}
                </p>
              ),
            )}
          </section>
        )}

        {revealed.length > 0 && (
          <section className="card mb-4 p-4">
            <h2 className="mb-2 text-sm text-accent">Revealed</h2>
            <ul className="flex flex-col gap-3">
              {revealed.map((g) => {
                const openLine = openingSpread(snapsByGame.get(g.id) ?? []);
                const rows = guesses
                  .filter((x) => x.game_id === g.id)
                  .sort(
                    (a, b) => (a.abs_error ?? Infinity) - (b.abs_error ?? Infinity),
                  );
                return (
                  <li key={g.id}>
                    <p className="stat mb-1 text-sm text-chalk">
                      {label(g)}{" "}
                      <span className="text-chalk/55">
                        · opened {openLine === null ? "—" : fmtSpread(openLine)}
                      </span>
                    </p>
                    {rows.length === 0 ? (
                      <p className="pl-3 text-xs text-dim">Nobody guessed this one.</p>
                    ) : (
                      <ul className="flex flex-col gap-0.5 pl-3">
                        {rows.map((r) => (
                          <li
                            key={`${r.user_id}-${r.game_id}`}
                            className="stat flex items-center justify-between text-xs"
                          >
                            <span className="font-sans text-chalk/80">
                              {nameById.get(r.user_id) ?? "?"}
                            </span>
                            <span className="text-chalk/60">
                              {fmtSpread(Number(r.guess))}
                              {r.abs_error !== null && (
                                <span
                                  className={
                                    Number(r.abs_error) <= 1 ? "text-win" : "text-chalk/45"
                                  }
                                >
                                  {" "}
                                  · off by {Number(r.abs_error)}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {board.length > 0 && (
          <section className="card p-4">
            <h2 className="mb-2 text-sm text-accent">Sharpest eye — season</h2>
            <ul className="flex flex-col gap-1">
              {board.map((b, i) => (
                <li key={b.name} className="stat flex items-center justify-between text-sm">
                  <span className="font-sans text-chalk">
                    {i + 1}. {b.name}
                  </span>
                  <span className="text-dim">
                    off by {b.mae.toFixed(2)} avg · {b.n} {b.n === 1 ? "line" : "lines"}
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

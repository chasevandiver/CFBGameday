import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { ConsensusBadge, EdgeBadge, fmtSpread } from "../../components/badges";
import { fetchCurrentSeasonWeek, fetchSlate, type SlateGame } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";
import { WINDOW_ORDER, kickTime, kickoffWindow, type KickoffWindow } from "../../lib/time";

export const dynamic = "force-dynamic";

export default async function SlatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId, week } = await fetchCurrentSeasonWeek(supabase);
  const slate = await fetchSlate(supabase, seasonId, week, user?.id ?? null);

  const groups = new Map<KickoffWindow, SlateGame[]>();
  for (const sg of slate) {
    if (!sg.game.start_ts) continue;
    const w = kickoffWindow(sg.game.start_ts);
    groups.set(w, [...(groups.get(w) ?? []), sg]);
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-2xl">Week {week}</h1>
          <p className="stat text-xs text-chalk/50">all times Central</p>
        </div>

        {slate.length === 0 && (
          <p className="rounded border border-chalk/15 bg-surface p-6 text-chalk/70">
            No games loaded for week {week} yet — the slate fills in when data ingestion runs.
          </p>
        )}

        {WINDOW_ORDER.map((window) => {
          const games = groups.get(window);
          if (!games || games.length === 0) return null;
          return (
            <section key={window} className="mb-8">
              <h2 className="mb-2 border-b border-chalk/15 pb-1 text-sm text-gold">{window}</h2>
              <ul className="flex flex-col gap-2">
                {games.map((sg) => (
                  <SlateRow key={sg.game.id} sg={sg} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </>
  );
}

function SlateRow({ sg }: { sg: SlateGame }) {
  const { game, home, away, prediction } = sg;
  const live = game.status === "in_progress";
  const final = game.status === "final";

  return (
    <li>
      <Link
        href={`/game/${game.id}`}
        className="flex items-center gap-3 rounded border border-chalk/10 bg-surface px-3 py-2.5 hover:border-gold/50"
      >
        <div className="stat w-16 shrink-0 text-xs text-chalk/60">
          {live ? (
            <span className="text-flag">
              {game.current_period ? `Q${game.current_period}` : "LIVE"} {game.current_clock ?? ""}
            </span>
          ) : final ? (
            "Final"
          ) : game.start_ts ? (
            kickTime(game.start_ts)
          ) : (
            "TBD"
          )}
        </div>

        <div className="min-w-0 flex-1">
          <TeamLine team={away.school} points={game.away_points} showScore={live || final} />
          <TeamLine team={home.school} points={game.home_points} showScore={live || final} />
        </div>

        <div className="stat shrink-0 text-right text-xs">
          <div className="text-chalk">
            {home.abbreviation ?? home.school} {fmtSpread(sg.currentSpread)}
          </div>
          {sg.openSpread !== null && sg.openSpread !== sg.currentSpread && (
            <div className="text-chalk/50">open {fmtSpread(sg.openSpread)}</div>
          )}
          {sg.currentTotal !== null && <div className="text-chalk/50">O/U {sg.currentTotal}</div>}
        </div>

        <div className="flex w-20 shrink-0 flex-col items-end gap-1">
          <EdgeBadge flag={prediction?.edge_flag ?? null} />
          <ConsensusBadge on={prediction?.consensus_flag ?? false} />
          {sg.myPick && (
            <span className="stat rounded bg-gold/20 px-1.5 py-0.5 text-[11px] uppercase text-gold">
              picked
            </span>
          )}
          {game.tv && <span className="stat text-[11px] text-chalk/40">{game.tv}</span>}
        </div>
      </Link>
    </li>
  );
}

function TeamLine({
  team,
  points,
  showScore,
}: {
  team: string;
  points: number | null;
  showScore: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="truncate">{team}</span>
      {showScore && <span className="stat text-sm">{points ?? 0}</span>}
    </div>
  );
}

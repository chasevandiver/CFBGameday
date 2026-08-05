import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { ConsensusChip, EdgeChip } from "../../components/slate/chips";
import { kickParts, DEFAULT_TZ } from "../../lib/kick";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../lib/queries";
import {
  fmtPct,
  fmtSpread,
  isDead,
  isFinal,
  stakeForPrediction,
  type GameView,
} from "../../lib/slate";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edges" };

/**
 * The soft-market guide (docs/SPEC.md §5.1): this week's flagged games,
 * biggest disagreement with the market first, with the ¼-Kelly stake.
 */
export default async function EdgesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId, week } = await fetchCurrentSeasonWeek(supabase);
  const data = await fetchSlateView(supabase, seasonId, week, user?.id ?? null);

  const flagged = data.games
    .filter((g) => g.prediction?.edgeFlag && !isDead(g) && !isFinal(g))
    .sort((a, b) => {
      const big = (g: GameView) => (g.prediction?.edgeFlag === "BIG_EDGE" ? 1 : 0);
      if (big(b) !== big(a)) return big(b) - big(a);
      return Math.abs(b.prediction?.edge ?? 0) - Math.abs(a.prediction?.edge ?? 0);
    });

  const anyFrozen = flagged.some((g) => g.prediction?.frozen);

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-1 flex items-baseline justify-between">
          <h1 className="text-2xl">Edges</h1>
          <p className="stat text-xs text-chalk/50">week {week}</p>
        </div>
        <p className="mb-5 text-sm text-dim">
          Games where the model disagrees with the market by 2+ points. Stake is ¼ Kelly on the
          cover probability, capped at 2u.
          {!anyFrozen && flagged.length > 0 && " Prices are unfrozen until Thursday 10pm CT."}
        </p>

        {flagged.length === 0 ? (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">No flagged edges yet</p>
            <p className="mt-1 text-sm text-dim">
              Edges post with the Thursday freeze — check back once this week&rsquo;s predictions
              are priced.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {flagged.map((g) => (
              <EdgeRow key={g.id} game={g} />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function EdgeRow({ game }: { game: GameView }) {
  const p = game.prediction!;
  const stake = stakeForPrediction(p);
  const sideTeam = stake?.side === "home" ? game.home : game.away;
  const kick = game.startTs ? kickParts(game.startTs, DEFAULT_TZ) : null;
  const marketSpread = p.vegasSpread ?? game.lines.spread;

  return (
    <li className="card card-hover relative px-4 py-3.5">
      <Link
        href={`/game/${game.id}`}
        aria-label={`${game.away.school} at ${game.home.school}`}
        className="absolute inset-0 rounded-[12px] focus-visible:outline-2 focus-visible:outline-accent"
      />
      <div className="pointer-events-none flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="scorebug truncate text-[15px] text-chalk">
            {game.away.school} @ {game.home.school}
          </p>
          <p className="stat mt-0.5 text-[11px] text-dim">
            {kick ? `${kick.day} ${kick.time} CT` : "TBD"}
            {game.tv ? ` · ${game.tv}` : ""}
            {p.frozen ? " · frozen" : " · unfrozen"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <EdgeChip flag={p.edgeFlag} edge={p.edge} />
          <ConsensusChip on={p.consensus} />
        </div>
      </div>
      <div className="stat pointer-events-none mt-2.5 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
        <EdgeStat label="Market" value={`${game.home.abbr} ${fmtSpread(marketSpread)}`} />
        <EdgeStat label="Model" value={`${game.home.abbr} ${fmtSpread(p.spread)}`} />
        <EdgeStat
          label="Cover prob"
          value={
            stake && p.coverProb !== null
              ? `${fmtPct(stake.side === "home" ? p.coverProb : 1 - p.coverProb)} ${sideTeam?.abbr ?? ""}`
              : "–"
          }
        />
        <EdgeStat
          label="Stake"
          value={
            stake === null
              ? "–"
              : stake.units <= 0
                ? "pass"
                : `${stake.units}u ${sideTeam?.abbr ?? ""} ${fmtSpread(stake.line)}`
          }
          strong
        />
      </div>
    </li>
  );
}

function EdgeStat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-elev px-2 py-2 ring-1 ring-inset ring-chalk/8">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-chalk/40">{label}</p>
      <p className={`mt-0.5 text-sm ${strong ? "font-semibold text-accent" : "text-chalk"}`}>{value}</p>
    </div>
  );
}

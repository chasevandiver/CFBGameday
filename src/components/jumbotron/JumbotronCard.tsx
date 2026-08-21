"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { breakLabel, periodLabel, underTwo } from "../../lib/kick";
import { fmtPct } from "../../lib/slate";
import { liveHomeWinProb, type GameView, type TeamView } from "../../lib/slate";
import { LiveBadge } from "../slate/chips";
import { LiveSituation } from "../slate/LiveSituation";

/**
 * The featured game at stadium scale (R5-A): three facts at 10× type —
 * who, the score, the clock — then the situation. Deliberately NOT
 * GameCard: that is a dense betting card; this is a board read from across
 * the room. `.scorebug` keeps the numerals tabular so a 9 → 10 shifts
 * nothing on a screen nobody is touching.
 */

function TeamRow({ team, points, leading }: { team: TeamView; points: number; leading: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-lg px-3 py-1.5"
      style={
        {
          background: `linear-gradient(90deg, color-mix(in srgb, ${team.color ?? "var(--push)"} 16%, transparent), transparent 65%)`,
        } as CSSProperties
      }
    >
      <span
        className={`scorebug truncate text-4xl sm:text-5xl ${leading ? "text-chalk" : "text-chalk/60"}`}
      >
        {team.pollRank !== null && (
          <span className="mr-2 align-top text-xl text-accent">{team.pollRank}</span>
        )}
        {team.abbr}
      </span>
      <span className={`scorebug text-5xl sm:text-6xl ${leading ? "text-chalk" : "text-chalk/60"}`}>
        {points}
      </span>
    </div>
  );
}

export function JumbotronCard({ game, demo = false }: { game: GameView; demo?: boolean }) {
  const h = game.homePoints ?? 0;
  const a = game.awayPoints ?? 0;
  const u2m = underTwo(game.period, game.clock);
  const prob = liveHomeWinProb(game);

  const body = (
    <div className="card relative overflow-hidden p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <LiveBadge />
          <span className={`stat text-lg font-semibold ${u2m ? "u2m" : "text-chalk"}`}>
            {breakLabel(game.period, game.clock) ?? (
              <>
                {periodLabel(game.period)}
                {game.clock ? ` · ${game.clock}` : ""}
              </>
            )}
          </span>
        </span>
        {game.tv && <span className="stat text-sm text-dim">{game.tv}</span>}
      </div>
      <div className="mt-3 space-y-2">
        <TeamRow team={game.away} points={a} leading={a >= h} />
        <TeamRow team={game.home} points={h} leading={h >= a} />
      </div>
      <LiveSituation game={game} />
      {prob !== null && (
        <p className="stat mt-3 text-sm text-dim">
          {prob >= 0.5 ? game.home.abbr : game.away.abbr} win{" "}
          <span className="font-semibold text-chalk">
            {fmtPct(prob >= 0.5 ? prob : 1 - prob)}
          </span>
        </p>
      )}
    </div>
  );

  // Demo game ids are invented; the card must not link into a 404.
  if (demo) return body;
  return (
    <Link href={`/game/${game.id}`} className="block focus-visible:outline-2 focus-visible:outline-accent">
      {body}
    </Link>
  );
}

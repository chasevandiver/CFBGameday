"use client";

import { Tv } from "lucide-react";
import Link from "next/link";
import { kickParts } from "../../lib/kick";
import {
  fmtMoneyline,
  fmtSpread,
  fmtTotal,
  isFinal,
  isLive,
  modelPicks,
  type GameView,
  type TeamView,
} from "../../lib/slate";
import { periodLabel } from "../../lib/kick";
import { ConsensusChip, EdgeChip, LiveBadge } from "./chips";
import { TeamMark } from "./TeamMark";
import { WinProbBar } from "./WinProbBar";

/** Full-width "Game of the Day" spotlight — broadcast-graphic energy. */
export function HeroCard({ game, tz }: { game: GameView; tz: string }) {
  const live = isLive(game);
  const final = isFinal(game);
  const showScore = live || final;
  const p = game.prediction;
  const picks = modelPicks(game);
  const homeColor = game.home.color ?? "#5b6472";
  const awayColor = game.away.color ?? "#5b6472";

  return (
    <article className={`card card-hover card-in relative overflow-hidden ${live ? "card-live" : ""}`}>
      {/* diagonal team-color wash */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.16]"
        style={{
          background: `linear-gradient(105deg, ${awayColor} 0%, ${awayColor} 38%, transparent 50%, ${homeColor} 62%, ${homeColor} 100%)`,
        }}
      />
      <div aria-hidden className="absolute inset-x-0 top-0 flex h-1">
        <span className="flex-1" style={{ background: awayColor }} />
        <span className="flex-1" style={{ background: homeColor }} />
      </div>

      <Link
        href={`/game/${game.id}`}
        aria-label={`${game.away.school} at ${game.home.school} — game of the day`}
        className="absolute inset-0 z-0 rounded-[12px] focus-visible:outline-2 focus-visible:outline-accent"
      />

      <div className="pointer-events-none relative z-10 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-3">
          <span className="chip bg-accent/15 text-accent">Game of the Day</span>
          <span className="stat flex items-center gap-2 text-xs text-dim">
            {live ? (
              <>
                <LiveBadge />
                <span className="font-semibold text-chalk">
                  {periodLabel(game.period)}
                  {game.clock ? ` · ${game.clock}` : ""}
                </span>
              </>
            ) : final ? (
              <span className="font-semibold uppercase text-dim">Final</span>
            ) : game.startTs ? (
              <HeroKick iso={game.startTs} tz={tz} />
            ) : (
              "TBD"
            )}
            {game.tv && (
              <span className="flex items-center gap-1">
                <Tv size={12} aria-hidden />
                {game.tv}
              </span>
            )}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-6">
          <HeroTeam team={game.away} points={game.awayPoints} showScore={showScore} align="left" other={game.homePoints} final={final} />
          <div className="text-center">
            {showScore ? (
              <span className="scorebug text-lg text-chalk/40">–</span>
            ) : (
              <div className="flex flex-col items-center gap-0.5">
                <span className="scorebug whitespace-nowrap text-lg leading-none text-chalk sm:text-3xl">
                  {game.lines.spread !== null
                    ? `${game.lines.spread <= 0 ? game.home.abbr : game.away.abbr} ${fmtSpread(
                        -Math.abs(game.lines.spread),
                      )}`
                    : "@"}
                </span>
                {game.lines.total !== null && (
                  <span className="stat whitespace-nowrap text-xs text-dim">
                    O/U {fmtTotal(game.lines.total)}
                  </span>
                )}
                {game.lines.mlHome !== null && game.lines.mlAway !== null && (
                  <span className="stat hidden whitespace-nowrap text-[10.5px] text-chalk/40 sm:block">
                    {game.away.abbr} {fmtMoneyline(game.lines.mlAway)} · {game.home.abbr}{" "}
                    {fmtMoneyline(game.lines.mlHome)}
                  </span>
                )}
              </div>
            )}
          </div>
          <HeroTeam team={game.home} points={game.homePoints} showScore={showScore} align="right" other={game.awayPoints} final={final} />
        </div>

        {p && (
          <div className="mx-auto mt-4 max-w-xl">
            <WinProbBar home={game.home} away={game.away} homeWinProb={p.homeWinProb} height={7} />
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
              <EdgeChip flag={p.edgeFlag} edge={p.edge} />
              <ConsensusChip on={p.consensus} />
              <span className="stat text-[11px] text-dim">
                {p.homeScore !== null && p.awayScore !== null && (
                  <>
                    Model {game.home.abbr} {Math.round(p.homeScore)}–{Math.round(p.awayScore)}
                  </>
                )}
                {picks.atsSide && (
                  <>
                    {" · "}
                    <span className="text-chalk">
                      {(picks.atsSide === "home" ? game.home : game.away).abbr} ATS
                    </span>
                  </>
                )}
                {picks.ouLean && (
                  <>
                    {" · "}
                    <span className="text-chalk">{picks.ouLean === "over" ? "Over" : "Under"}</span>
                  </>
                )}
              </span>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function HeroKick({ iso, tz }: { iso: string; tz: string }) {
  const { day, time } = kickParts(iso, tz);
  return (
    <span>
      <span className="font-semibold text-chalk">{day}</span> {time}
    </span>
  );
}

function HeroTeam({
  team,
  points,
  showScore,
  align,
  other,
  final,
}: {
  team: TeamView;
  points: number | null;
  showScore: boolean;
  align: "left" | "right";
  other: number | null;
  final: boolean;
}) {
  const lost = final && points !== null && other !== null && points < other;
  const right = align === "right";
  return (
    <div
      className={`flex items-center gap-3 sm:gap-4 ${right ? "flex-row-reverse" : ""} ${
        lost ? "opacity-50" : ""
      }`}
    >
      <TeamMark team={team} size={56} glow />
      <div className={`min-w-0 ${right ? "text-right" : ""}`}>
        <p className="stat text-[10.5px] leading-none text-dim">
          {team.rank !== null && team.rank <= 25 && <span className="font-semibold">#{team.rank} </span>}
          {team.record ?? ""}
        </p>
        <p className="scorebug truncate text-xl leading-tight text-chalk sm:text-2xl">
          {team.school}
        </p>
        {showScore && (
          <p className={`scorebug text-4xl leading-none sm:text-5xl ${lost ? "text-dim" : "text-chalk"}`}>
            {points ?? 0}
          </p>
        )}
      </div>
    </div>
  );
}

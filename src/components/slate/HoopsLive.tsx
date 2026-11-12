/**
 * The live block for a college basketball game — what `LiveSituation` is for
 * football (CBB-9).
 *
 * Football's block is down, distance, the ball on a field and the last play.
 * None of the first three exist here, so this is not that component with the
 * strip removed; it answers basketball's own two questions:
 *
 *   ATS   who is covering the number right now, and by how much
 *   PACE  the total this game is on pace for, against the market's
 *
 * and then the last play, with the run in front of it when somebody is on
 * one. Stated for every lined game, bet or not — on a basketball night the
 * cover and the pace ARE the scoreboard for this audience.
 *
 * Neither number is coloured. Green and red on a card mean "your money"
 * (GameCard's aura rule) and these are facts about the game; a red "under"
 * beside a bet that is winning would say two things at once.
 *
 * Layout is fixed: one stat row of constant height, then a two-line play, so
 * a score going in changes digits and nothing else (DESIGN.md: no layout
 * shift on updates).
 */

"use client";

import { useEffect, useState } from "react";
import { cbbBreakLabel, hoopsRead, runLabel } from "../../lib/cbb";
import { fmtSpread, fmtTotal, lineForSide, playAge, type GameView } from "../../lib/slate";

const LABEL = "stat mr-1 text-[9px] font-semibold uppercase tracking-widest text-chalk/55";

export function HoopsLive({ game, compact = false }: { game: GameView; compact?: boolean }) {
  // Same clock contract as LiveSituation (LIVE-4): null until mount so server
  // and browser never disagree at hydration, then a tick every 30 seconds.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const read = hoopsRead(game);
  const run = game.hoops?.run ?? null;
  const runText = runLabel(run);
  const runTeam = run ? (run.side === "home" ? game.home : game.away) : null;
  const atBreak = cbbBreakLabel(game.period, game.clock) !== null;
  const age =
    game.lastPlayAt && !atBreak && nowMs !== null ? playAge(game.lastPlayAt, nowMs) : null;

  const coverTeam =
    read.cover && read.cover.side !== "push"
      ? read.cover.side === "home"
        ? game.home
        : game.away
      : null;
  const hasRow = read.cover !== null || read.total !== null;
  if (!hasRow && !game.lastPlay && !runText) return null;

  return (
    <div className={compact ? "mt-1.5" : "mt-2.5"}>
      {hasRow && (
        <div className="flex min-h-[18px] items-baseline justify-between gap-3">
          <span className="stat min-w-0 truncate text-[12.5px] font-semibold text-chalk">
            {read.cover && (
              <>
                <span className={LABEL}>ATS</span>
                {coverTeam ? (
                  <>
                    {coverTeam.abbr}{" "}
                    {fmtSpread(lineForSide(read.cover.side, game.lines.spread))}
                    <span className="font-medium text-dim"> by {read.cover.by}</span>
                  </>
                ) : (
                  <span className="font-medium text-dim">on the number</span>
                )}
              </>
            )}
          </span>
          {read.total !== null && (
            <span className="stat shrink-0 text-[12.5px] font-semibold text-chalk">
              <span className={LABEL}>Pace</span>
              {/* An en dash while there is no pace yet (the first four
                  minutes, and overtime) keeps the cell from appearing later
                  and shoving the ATS read sideways. */}
              {read.pace ?? "–"}
              <span className="font-medium text-dim"> / {fmtTotal(read.total)}</span>
            </span>
          )}
        </div>
      )}
      {(game.lastPlay || runText) && (
        <p className="last-play">
          {runText && runTeam && (
            <span className="chip mr-1.5 bg-chalk/10 align-[1px] text-chalk">
              {runTeam.abbr} {runText}
            </span>
          )}
          {game.lastPlay && (
            <>
              <span className={LABEL}>Last</span>
              {game.lastPlay}
            </>
          )}
          {age && (
            <span
              className="stat ml-1 text-[9px] tabular-nums text-chalk/45"
              title="Time since this play arrived"
            >
              {age}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

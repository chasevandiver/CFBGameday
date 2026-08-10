"use client";

import { Tv } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useViewerTz } from "../../lib/client-store";
import type { GameRow } from "../../lib/db-types";
import type { PickMarket } from "../../lib/grade";
import { DEFAULT_TZ, kickDateLong, kickParts, periodLabel, tzLabel } from "../../lib/kick";
import { statusForBet, statusForPick } from "../../lib/live-status";
import {
  fmtPct,
  fmtSpread,
  fmtTotal,
  isRedZone,
  lineForSide,
  pickSideLabel,
  type LinePoint,
  type MyBetView,
  type TeamView,
} from "../../lib/slate";
import { liveWinProb } from "../../model/live";
import { useGamesRealtime } from "../../lib/use-games-realtime";
import { LiveBadge, LiveStatusChip } from "../slate/chips";
import { Sparkline } from "../slate/Sparkline";
import { TeamMark } from "../slate/TeamMark";
import { WinProbBar } from "../slate/WinProbBar";

export interface GameLiveState {
  status: string;
  homePoints: number | null;
  awayPoints: number | null;
  period: number | null;
  clock: string | null;
  situation: string | null;
  lastPlay: string | null;
  possession: "home" | "away" | null;
}

interface Props {
  gameId: number;
  week: number;
  seasonId: number;
  neutralSite: boolean;
  tv: string | null;
  startTs: string | null;
  home: TeamView;
  away: TeamView;
  /** Pregame model line (home perspective) + win prob; null when unpriced */
  prediction: { spread: number; homeWinProb: number } | null;
  myPick: { market: PickMarket; side: string; line: number | null } | null;
  myBets: MyBetView[];
  initial: GameLiveState;
}

/**
 * The broadcast header as a live island: realtime UPDATEs stream in the
 * moment the scoreboard job writes, a visibility-gated poll heals missed
 * events, and the win-prob bar keeps a session history sparkline. The page
 * you leave open during the game now moves on its own (audit: the game
 * detail page was the only live surface that didn't update).
 */
export function GameHeader({
  gameId,
  week,
  seasonId,
  neutralSite,
  tv,
  startTs,
  home,
  away,
  prediction,
  myPick,
  myBets,
  initial,
}: Props) {
  const viewerTz = useViewerTz(DEFAULT_TZ);
  const [g, setG] = useState<GameLiveState>(initial);

  const live = g.status === "in_progress";
  const final = g.status === "final";
  const dead = g.status === "postponed" || g.status === "canceled";
  const showScore = live || final;

  // session history of the live win prob → tiny game-flow sparkline.
  // Appended in the update handlers (never during render).
  const probOf = useCallback(
    (s: GameLiveState): number | null =>
      s.status === "in_progress"
        ? liveWinProb({
            pregameMargin: prediction ? -prediction.spread : 0,
            homePoints: s.homePoints ?? 0,
            awayPoints: s.awayPoints ?? 0,
            period: s.period,
            clock: s.clock,
          })
        : null,
    [prediction],
  );
  const [probHistory, setProbHistory] = useState<LinePoint[]>(() => {
    const p = probOf(initial);
    return p === null ? [] : [{ t: "0", v: p }];
  });

  const apply = useCallback(
    (row: {
      status: string;
      home_points: number | null;
      away_points: number | null;
      current_period: number | null;
      current_clock: string | null;
      current_situation: string | null;
      last_play: string | null;
      possession: "home" | "away" | null;
    }) => {
      const next: GameLiveState = {
        status: row.status,
        homePoints: row.home_points,
        awayPoints: row.away_points,
        period: row.current_period,
        clock: row.current_clock,
        situation: row.current_situation,
        lastPlay: row.last_play,
        possession: row.possession,
      };
      setG(next);
      const p = probOf(next);
      if (p !== null) {
        setProbHistory((h) => {
          const last = h[h.length - 1];
          if (last && Math.abs(last.v - p) < 0.005) return h;
          return [...h.slice(-39), { t: String(h.length), v: p }];
        });
      }
    },
    [probOf],
  );

  // realtime while the game could still move
  useGamesRealtime({
    enabled: !final && !dead,
    week,
    seasonId,
    onGameUpdate: (row: GameRow) => {
      if (row.id === gameId) apply(row);
    },
  });

  // poll heal: 45s live, 3min pregame; stops once final
  useEffect(() => {
    if (final || dead) return;
    const load = () =>
      fetch(`/api/game/${gameId}`, { cache: "no-store" })
        .then(async (res) => {
          if (res.ok) apply(await res.json());
        })
        .catch(() => {
          /* transient — next tick retries */
        });
    const id = setInterval(
      () => {
        if (document.visibilityState === "visible") void load();
      },
      live ? 45_000 : 180_000,
    );
    return () => clearInterval(id);
  }, [gameId, live, final, dead, apply]);

  const hPts = g.homePoints ?? 0;
  const aPts = g.awayPoints ?? 0;
  const liveProb = probOf(g);

  const redZone =
    live && isRedZone({ status: g.status, possession: g.possession, situation: g.situation, home, away });
  const posAbbr = g.possession === "home" ? home.abbr : g.possession === "away" ? away.abbr : null;

  const myPickStatus = useMemo(
    () =>
      live && myPick ? statusForPick(myPick.market, myPick.side, myPick.line, hPts, aPts) : null,
    [live, myPick, hPts, aPts],
  );
  const myBetStatuses = useMemo(
    () =>
      live
        ? myBets
            .map((b) => ({ bet: b, status: statusForBet(b, hPts, aPts) }))
            .filter((x): x is { bet: MyBetView; status: NonNullable<typeof x.status> } => x.status !== null)
        : [],
    [live, myBets, hPts, aPts],
  );

  const homeLost = final && g.homePoints !== null && g.awayPoints !== null && hPts < aPts;
  const awayLost = final && g.homePoints !== null && g.awayPoints !== null && aPts < hPts;
  const homeColor = home.color ?? "var(--push)";
  const awayColor = away.color ?? "var(--push)";

  return (
    <section className={`card relative overflow-hidden ${live ? "card-live" : ""}`}>
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

      <div className="relative px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-2 text-xs text-dim">
          <span className="stat">
            {live ? (
              <span className="flex items-center gap-2">
                <LiveBadge />
                <span className="font-semibold text-chalk">
                  {periodLabel(g.period)}
                  {g.clock ? ` · ${g.clock}` : ""}
                </span>
              </span>
            ) : final ? (
              <span className="font-semibold uppercase">
                Final
                {g.period !== null && g.period > 4 ? ` / ${periodLabel(g.period)}` : ""}
              </span>
            ) : dead ? (
              <span className="font-semibold uppercase text-push">{g.status}</span>
            ) : startTs ? (
              `${kickDateLong(startTs, viewerTz)} · ${kickParts(startTs, viewerTz).time} ${tzLabel(viewerTz)}`
            ) : (
              "Kickoff TBD"
            )}
          </span>
          {tv && (
            <span className="stat flex items-center gap-1">
              <Tv size={12} aria-hidden />
              {tv}
            </span>
          )}
        </div>

        {/* score changes announced without re-reading the whole page */}
        <p className="sr-only" aria-live="polite">
          {live
            ? `${away.abbr} ${aPts}, ${home.abbr} ${hPts}, ${periodLabel(g.period)}`
            : final
              ? `Final: ${away.abbr} ${aPts}, ${home.abbr} ${hPts}`
              : ""}
        </p>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
          <HeaderTeam team={away} points={g.awayPoints} showScore={showScore} lost={awayLost} align="left" hasBall={live && g.possession === "away"} />
          <span className="scorebug text-lg text-chalk/35">{neutralSite ? "vs" : "@"}</span>
          <HeaderTeam team={home} points={g.homePoints} showScore={showScore} lost={homeLost} align="right" hasBall={live && g.possession === "home"} />
        </div>

        {live && g.situation && (
          <p className="stat mt-3 flex flex-wrap items-center justify-center gap-1.5 text-center text-sm text-chalk">
            <span>
              {posAbbr ? `${posAbbr} ball · ` : ""}
              {g.situation}
            </span>
            {redZone && <span className="chip bg-loss/15 text-loss">Red zone</span>}
          </p>
        )}

        {live && g.lastPlay && (
          <p className="mt-2 text-center text-xs leading-snug text-dim">
            <span className="stat mr-1.5 text-[10px] font-semibold uppercase tracking-widest text-chalk/55">
              Last
            </span>
            {g.lastPlay}
          </p>
        )}

        {(prediction || liveProb !== null) && (
          <div className="mx-auto mt-4 max-w-md">
            <WinProbBar
              home={home}
              away={away}
              homeWinProb={liveProb ?? prediction!.homeWinProb}
              height={7}
            />
            {liveProb !== null && (
              <p className="stat mt-1.5 flex items-center justify-center gap-2 text-center text-[10.5px] leading-none text-dim">
                <span>
                  Live win probability
                  {prediction && (
                    <>
                      {" · pregame "}
                      <span className="text-chalk">
                        {fmtPct(prediction.homeWinProb)} {home.abbr}
                      </span>
                    </>
                  )}
                </span>
                {probHistory.length >= 2 && (
                  <Sparkline points={probHistory} width={56} height={14} />
                )}
              </p>
            )}
          </div>
        )}

        {(myPickStatus || myBetStatuses.length > 0) && (
          <div className="mt-4 border-t border-chalk/10 pt-3">
            <p className="mb-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-chalk/55">
              Your action
            </p>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {myPickStatus && myPick && (
                <LiveStatusChip
                  prefix={`Pick ${pickSideLabel(myPick.market, myPick.side, myPick.line, home.abbr, away.abbr, { compact: true })}`}
                  status={myPickStatus}
                />
              )}
              {myBetStatuses.map(({ bet, status }) => (
                <LiveStatusChip
                  key={bet.id}
                  prefix={
                    bet.betType === "spread"
                      ? // stored home-perspective; the ticket reads the side's number
                        `${(bet.side === "home" ? home : away).abbr} ${fmtSpread(lineForSide(bet.side ?? "home", bet.line))}`
                      : bet.betType === "total"
                        ? `${bet.side === "over" ? "O" : "U"} ${fmtTotal(bet.line)}`
                        : `${(bet.side === "home" ? home : away).abbr} ML`
                  }
                  status={status}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function HeaderTeam({
  team,
  points,
  showScore,
  lost,
  align,
  hasBall = false,
}: {
  team: TeamView;
  points: number | null;
  showScore: boolean;
  lost: boolean;
  align: "left" | "right";
  hasBall?: boolean;
}) {
  const right = align === "right";
  const ball = hasBall && (
    <span
      role="img"
      aria-label={`${team.school} has possession`}
      title="Possession"
      className="inline-block h-2 w-2 rounded-full bg-accent"
    />
  );
  return (
    <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""} ${lost ? "opacity-50" : ""}`}>
      <TeamMark team={team} size={48} glow />
      <div className={`min-w-0 ${right ? "text-right" : ""}`}>
        <p className="scorebug truncate text-lg leading-tight text-chalk sm:text-xl">{team.school}</p>
        <p className="stat text-[10.5px] text-dim">
          {[team.conference, team.pollRank !== null && team.poll ? `#${team.pollRank} ${team.poll}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {showScore && (
          <p
            className={`scorebug flex items-center gap-2 text-4xl leading-none ${
              right ? "justify-end" : ""
            } ${lost ? "text-dim" : "text-chalk"}`}
          >
            {!right && ball}
            {points ?? 0}
            {right && ball}
          </p>
        )}
      </div>
    </div>
  );
}

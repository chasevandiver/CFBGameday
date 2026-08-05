"use client";

import { CloudRain, Snowflake, Star, Tv, Wind } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { inSlip, useBetSlip, type SlipSelection } from "../../lib/bet-slip-store";
import { kickParts, periodLabel } from "../../lib/kick";
import { statusForBet, statusForPick } from "../../lib/live-status";
import {
  atsResult,
  displayRank,
  fmtMoneyline,
  fmtPct,
  fmtSpread,
  fmtTotal,
  gradeModel,
  isDead,
  isFinal,
  isLive,
  isRedZone,
  liveHomeWinProb,
  modelPicks,
  ouResult,
  spreadMove,
  type GameView,
  type MyBetView,
  type TeamView,
} from "../../lib/slate";
import { ConsensusChip, EdgeChip, LiveBadge, LiveStatusChip, MoveIndicator, PickedChip, RankBadge, ResultChip } from "./chips";
import { Sparkline } from "./Sparkline";
import { TeamMark } from "./TeamMark";
import { WinProbBar } from "./WinProbBar";

interface Props {
  game: GameView;
  tz: string;
  starred: number[];
  onStar: (teamId: number) => void;
  /** stagger index for the load-in animation */
  index?: number;
  /** Game of the Week — accent ring + chip, otherwise a normal card */
  featured?: boolean;
}

export function GameCard({ game, tz, starred, onStar, index = 0, featured = false }: Props) {
  const live = isLive(game);
  const final = isFinal(game);
  const dead = isDead(game);

  // brief team-colored flash when a live score ticks
  const prev = useRef<{ h: number | null; a: number | null }>({
    h: game.homePoints,
    a: game.awayPoints,
  });
  const [flash, setFlash] = useState<{ side: "home" | "away"; key: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    if (game.homePoints !== p.h && game.homePoints !== null && p.h !== null)
      setFlash({ side: "home", key: Date.now() });
    else if (game.awayPoints !== p.a && game.awayPoints !== null && p.a !== null)
      setFlash({ side: "away", key: Date.now() });
    prev.current = { h: game.homePoints, a: game.awayPoints };
  }, [game.homePoints, game.awayPoints]);

  const homeColor = game.home.color ?? "#5b6472";
  const awayColor = game.away.color ?? "#5b6472";

  return (
    <article
      className={`card card-hover card-in relative overflow-hidden ${live ? "card-live" : ""} ${
        featured ? "ring-1 ring-accent/40" : ""
      }`}
      style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
    >
      {/* team-color split accent edge */}
      <div aria-hidden className="absolute inset-x-0 top-0 flex h-[3px]">
        <span className="flex-1" style={{ background: awayColor }} />
        <span className="flex-1" style={{ background: homeColor }} />
      </div>

      <Link
        href={`/game/${game.id}`}
        aria-label={`${game.away.school} at ${game.home.school}`}
        className="absolute inset-0 z-0 rounded-[12px] focus-visible:outline-2 focus-visible:outline-accent"
      />

      <div className="pointer-events-none relative z-10 flex h-full flex-col p-3.5 pt-4">
        <CardHeader game={game} tz={tz} live={live} final={final} dead={dead} featured={featured} />

        <div key={game.status} className="fade-swap flex flex-1 flex-col">
          {!live && !final && !dead && <OddsColumnLabels game={game} />}
          <div className="mt-2 flex flex-col gap-2">
            <TeamRow
              game={game}
              team={game.away}
              side="away"
              starred={starred}
              onStar={onStar}
              flash={flash}
            />
            <TeamRow
              game={game}
              team={game.home}
              side="home"
              starred={starred}
              onStar={onStar}
              flash={flash}
            />
          </div>

          <div className="mt-auto">
            {dead ? null : final ? (
              <FinalFooter game={game} />
            ) : (
              <PregameFooter game={game} live={live} />
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/* ---- header ------------------------------------------------------------ */

function CardHeader({
  game,
  tz,
  live,
  final,
  dead,
  featured,
}: {
  game: GameView;
  tz: string;
  live: boolean;
  final: boolean;
  dead: boolean;
  featured: boolean;
}) {
  return (
    <div className="flex min-h-5 items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {featured && <span className="chip bg-accent/15 text-accent">Game of the Week</span>}
        {live ? (
          <>
            <LiveBadge />
            <span className="stat text-xs font-semibold text-chalk">
              {periodLabel(game.period)}
              {game.clock ? ` · ${game.clock}` : ""}
            </span>
          </>
        ) : final ? (
          <span className="stat text-xs font-semibold uppercase tracking-wide text-dim">
            Final{game.period !== null && game.period > 4 ? ` / ${periodLabel(game.period)}` : ""}
          </span>
        ) : dead ? (
          <span className="stat text-xs uppercase text-push">{game.status}</span>
        ) : game.startTs ? (
          <Kickoff iso={game.startTs} tz={tz} />
        ) : (
          <span className="stat text-xs text-dim">TBD</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <WeatherFlag game={game} />
        {game.tv && (
          <span className="stat flex items-center gap-1 text-[10.5px] font-medium text-dim">
            <Tv size={11} aria-hidden />
            {game.tv}
          </span>
        )}
      </div>
    </div>
  );
}

function Kickoff({ iso, tz }: { iso: string; tz: string }) {
  const { day, time } = kickParts(iso, tz);
  return (
    <span className="stat text-xs text-dim">
      <span className="font-semibold text-chalk">{day}</span> {time}
    </span>
  );
}

function WeatherFlag({ game }: { game: GameView }) {
  const w = game.weather;
  if (!w || game.dome || isFinal(game)) return null;
  const windy = (w.windMph ?? 0) >= 15;
  const wet = (w.precipProb ?? 0) >= 50;
  const cold = w.tempF !== null && w.tempF <= 25;
  if (!windy && !wet && !cold) return null;
  const Icon = windy ? Wind : wet ? CloudRain : Snowflake;
  const label = windy
    ? `Wind ${Math.round(w.windMph!)} mph`
    : wet
      ? `${Math.round(w.precipProb!)}% precip`
      : `${Math.round(w.tempF!)}°F`;
  return (
    <span className="stat flex items-center gap-1 text-[10.5px] text-edge" title={label}>
      <Icon size={11} aria-hidden />
      {label}
    </span>
  );
}

/* ---- team rows --------------------------------------------------------- */

function TeamRow({
  game,
  team,
  side,
  starred,
  onStar,
  flash,
}: {
  game: GameView;
  team: TeamView;
  side: "home" | "away";
  starred: number[];
  onStar: (teamId: number) => void;
  flash: { side: "home" | "away"; key: number } | null;
}) {
  const live = isLive(game);
  const final = isFinal(game);
  const showScore = live || final;
  const points = side === "home" ? game.homePoints : game.awayPoints;
  const oppPoints = side === "home" ? game.awayPoints : game.homePoints;
  const lost = final && points !== null && oppPoints !== null && points < oppPoints;
  const won = final && points !== null && oppPoints !== null && points > oppPoints;
  const isStarred = starred.includes(team.id);

  return (
    <div className={`flex items-center gap-2 transition-opacity ${lost ? "opacity-45" : ""}`}>
      <TeamMark team={team} size={26} glow />
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <RankBadge rank={displayRank(team)} poll={team.poll} />
        <span
          className={`scorebug truncate text-[15px] leading-tight ${won ? "text-chalk" : "text-chalk"}`}
        >
          {team.school}
        </span>
        {team.record && (
          <span className="stat shrink-0 text-[10px] leading-none text-dim">{team.record}</span>
        )}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onStar(team.id);
          }}
          aria-label={isStarred ? `Unstar ${team.school}` : `Star ${team.school}`}
          aria-pressed={isStarred}
          className={`pointer-events-auto shrink-0 rounded p-0.5 transition-colors ${
            isStarred ? "text-accent" : "text-chalk/20 hover:text-chalk/60"
          }`}
        >
          <Star size={12} fill={isStarred ? "currentColor" : "none"} aria-hidden />
        </button>
      </div>

      {showScore ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {live && game.possession === side && (
            <span
              role="img"
              aria-label={`${team.school} has possession`}
              title="Possession"
              className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
            />
          )}
          <span
            key={flash && flash.side === side ? flash.key : side}
            className={`scorebug w-10 text-right text-[22px] leading-none ${
              lost ? "text-dim" : "text-chalk"
            } ${flash && flash.side === side ? "score-flash" : ""}`}
            style={
              flash && flash.side === side
                ? ({ "--flash-color": team.color ?? "var(--accent)" } as React.CSSProperties)
                : undefined
            }
          >
            {points ?? 0}
          </span>
        </span>
      ) : (
        <OddsCells game={game} side={side} />
      )}
    </div>
  );
}

/** Column labels above the tappable odds grid — right-aligned over the cells. */
function OddsColumnLabels({ game }: { game: GameView }) {
  const { spread, total, mlHome, mlAway } = game.lines;
  if (spread === null && total === null && mlHome === null && mlAway === null) return null;
  return (
    <div className="mt-2 flex justify-end gap-1 text-[9px] font-semibold uppercase tracking-wider text-chalk/30">
      <span className="min-w-10 text-center">Spread</span>
      <span className="min-w-10 text-center">Total</span>
      <span className="min-w-12 text-center">Money</span>
    </div>
  );
}

/**
 * Sportsbook-style spread / total / ML cells for one team row. Each cell is a
 * button that adds the selection to the bet slip (tap again to remove, tap the
 * opposite side to swap).
 */
function OddsCells({ game, side }: { game: GameView; side: "home" | "away" }) {
  const { slip, toggle } = useBetSlip();
  const dead = isDead(game);
  const team = side === "home" ? game.home : game.away;
  const matchup = `${game.away.abbr} @ ${game.home.abbr}`;
  const { spread, total, mlHome, mlAway } = game.lines;
  const teamSpread = spread === null ? null : side === "home" ? spread : -spread;
  const ml = side === "home" ? mlHome : mlAway;
  const totalSide = side === "home" ? ("under" as const) : ("over" as const);
  const totalLabel = total === null ? "–" : `${side === "home" ? "U" : "O"} ${fmtTotal(total)}`;
  if (spread === null && total === null && ml === null)
    return <span className="stat text-[11px] text-chalk/30">no line</span>;

  const sel = (
    betType: SlipSelection["betType"],
    selSide: SlipSelection["side"],
    label: string,
    description: string,
    line: number | null,
    odds: number,
  ): SlipSelection => ({ gameId: game.id, betType, side: selSide, label, matchup, description, line, odds });

  return (
    <div className="flex shrink-0 gap-1">
      <OddsCell
        value={fmtSpread(teamSpread)}
        active={inSlip(slip, game.id, "spread", side)}
        disabled={dead || teamSpread === null}
        aria={`${team.abbr} ${fmtSpread(teamSpread)} spread — add to bet slip`}
        onToggle={() =>
          toggle(
            sel("spread", side, `${team.abbr} ${fmtSpread(teamSpread)}`,
              `${team.school} ${fmtSpread(teamSpread)} (${matchup})`, teamSpread, -110),
          )
        }
      />
      <OddsCell
        value={totalLabel}
        active={inSlip(slip, game.id, "total", totalSide)}
        disabled={dead || total === null}
        aria={`${totalSide === "over" ? "Over" : "Under"} ${fmtTotal(total)} — add to bet slip`}
        onToggle={() =>
          toggle(
            sel("total", totalSide, `${totalSide === "over" ? "O" : "U"} ${fmtTotal(total)}`,
              `${totalSide === "over" ? "Over" : "Under"} ${fmtTotal(total)} (${matchup})`, total, -110),
          )
        }
      />
      <OddsCell
        value={fmtMoneyline(ml)}
        active={inSlip(slip, game.id, "moneyline", side)}
        disabled={dead || ml === null}
        aria={`${team.abbr} moneyline ${fmtMoneyline(ml)} — add to bet slip`}
        wide
        onToggle={() =>
          toggle(sel("moneyline", side, `${team.abbr} ML`, `${team.school} ML (${matchup})`, null, ml ?? -110))
        }
      />
    </div>
  );
}

function OddsCell({
  value,
  active,
  disabled,
  aria,
  onToggle,
  wide = false,
}: {
  value: string;
  active: boolean;
  disabled: boolean;
  aria: string;
  onToggle: () => void;
  wide?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      disabled={disabled}
      aria-label={aria}
      aria-pressed={active}
      className={`stat pointer-events-auto flex h-7 items-center justify-center rounded-md px-1 text-[11px] font-medium transition-colors ${
        wide ? "min-w-12" : "min-w-10"
      } ${
        active
          ? "bg-accent text-accent-ink ring-1 ring-inset ring-accent"
          : "bg-elev text-chalk ring-1 ring-inset ring-chalk/8 hover:ring-accent/60"
      } disabled:cursor-default disabled:opacity-40 disabled:hover:ring-chalk/8`}
    >
      {value}
    </button>
  );
}

/* ---- footers ----------------------------------------------------------- */

/** "OSU -3.5" / "O 54.5" for the viewer's pick chip. */
function pickPrefix(g: GameView): string {
  const p = g.myPick!;
  if (p.side === "home") return `${g.home.abbr} ${fmtSpread(p.line)}`;
  if (p.side === "away") return `${g.away.abbr} ${fmtSpread(p.line)}`;
  return `${p.side === "over" ? "O" : "U"} ${fmtTotal(p.line)}`;
}

function betPrefix(g: GameView, b: MyBetView): string {
  const team = b.side === "home" ? g.home : g.away;
  if (b.betType === "spread") return `${team.abbr} ${fmtSpread(b.line)}`;
  if (b.betType === "total") return `${b.side === "over" ? "O" : "U"} ${fmtTotal(b.line)}`;
  return `${team.abbr} ML`;
}

function PregameFooter({ game, live }: { game: GameView; live: boolean }) {
  const p = game.prediction;
  const picks = modelPicks(game);
  const move = spreadMove(game);

  const liveProb = live ? liveHomeWinProb(game) : null;
  const redZone = live && isRedZone(game);
  const posTeam =
    game.possession === "home" ? game.home : game.possession === "away" ? game.away : null;
  const h = game.homePoints ?? 0;
  const a = game.awayPoints ?? 0;
  const pickStatus =
    live && game.myPick ? statusForPick(game.myPick.side, game.myPick.line, h, a) : null;
  const betStatuses = live
    ? game.myBets
        .map((b) => ({ bet: b, status: statusForBet(b, h, a) }))
        .filter((x): x is { bet: MyBetView; status: NonNullable<typeof x.status> } => x.status !== null)
    : [];

  return (
    <div className="mt-3 border-t border-chalk/8 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <EdgeChip flag={p?.edgeFlag ?? null} edge={p?.edge ?? null} />
          <ConsensusChip on={p?.consensus ?? false} />
          {game.myPick && !pickStatus && <PickedChip />}
        </div>
        <div className="flex items-center gap-1.5 text-dim">
          <MoveIndicator move={move} open={game.lines.spreadOpen} />
          <Sparkline points={game.spreadHistory} />
        </div>
      </div>

      {live && game.situation && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="stat text-[11px] font-medium text-chalk">
            {posTeam ? `${posTeam.abbr} ball · ` : ""}
            {game.situation}
          </span>
          {redZone && <span className="chip bg-loss/15 text-loss">Red zone</span>}
        </div>
      )}

      {(pickStatus || betStatuses.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pickStatus && <LiveStatusChip prefix={`Pick ${pickPrefix(game)}`} status={pickStatus} />}
          {betStatuses.map(({ bet, status }) => (
            <LiveStatusChip key={bet.id} prefix={betPrefix(game, bet)} status={status} />
          ))}
        </div>
      )}

      {(p || liveProb !== null) && (
        <div className="mt-2.5">
          <WinProbBar
            home={game.home}
            away={game.away}
            homeWinProb={liveProb ?? p!.homeWinProb}
          />
          <p className="stat mt-1.5 truncate text-[10.5px] leading-none text-dim">
            {live ? (
              <>
                Live win prob
                {p && (
                  <>
                    {" · pregame "}
                    <span className="text-chalk">
                      {fmtPct(p.homeWinProb)} {game.home.abbr}
                    </span>
                  </>
                )}
              </>
            ) : (
              <>
                {"Model: "}
                {p!.homeScore !== null && p!.awayScore !== null && (
                  <span className="text-chalk">
                    {game.home.abbr} {Math.round(p!.homeScore)}–{Math.round(p!.awayScore)}
                  </span>
                )}
                {picks.atsSide && (
                  <>
                    {" · "}
                    <span className="text-chalk">
                      {picks.atsSide === "home" ? game.home.abbr : game.away.abbr} ATS
                    </span>
                  </>
                )}
                {picks.ouLean && (
                  <>
                    {" · "}
                    <span className="text-chalk">
                      {picks.ouLean === "over" ? "Over" : "Under"} lean
                    </span>
                  </>
                )}
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function FinalFooter({ game }: { game: GameView }) {
  const cover = atsResult(game);
  const ou = ouResult(game);
  const grade = gradeModel(game);
  const { spread } = game.lines;

  // favorite by closing line; cover chip judges whether the favorite covered
  const favorite: "home" | "away" | null =
    spread === null ? null : spread < 0 ? "home" : spread > 0 ? "away" : null;
  const favTeam = favorite === "home" ? game.home : game.away;
  const favSpread = spread === null ? null : favorite === "home" ? spread : -spread;

  const chips: React.ReactNode[] = [];
  if (favorite && cover) {
    chips.push(
      <ResultChip
        key="ats"
        label={`${favTeam.abbr} ${fmtSpread(favSpread)}`}
        result={cover === "push" ? "push" : cover === favorite ? "pass" : "fail"}
      />,
    );
  }
  if (ou && game.lines.total !== null) {
    chips.push(
      <ResultChip
        key="ou"
        label={ou === "push" ? `Push ${fmtTotal(game.lines.total)}` : `${ou === "over" ? "O" : "U"} ${fmtTotal(game.lines.total)}`}
        result={ou === "push" ? "push" : ou === "over" ? "pass" : "fail"}
      />,
    );
  }

  const gradeChips: React.ReactNode[] = [];
  if (grade.winner !== null)
    gradeChips.push(
      <ResultChip key="w" label="Winner" result={grade.winner ? "pass" : "fail"} />,
    );
  if (grade.ats !== null)
    gradeChips.push(<ResultChip key="a" label="ATS" result={grade.ats ? "pass" : "fail"} />);
  if (grade.total !== null)
    gradeChips.push(<ResultChip key="t" label="O/U" result={grade.total ? "pass" : "fail"} />);

  if (chips.length === 0 && gradeChips.length === 0) return null;

  return (
    <div className="mt-3 border-t border-chalk/8 pt-2.5">
      {chips.length > 0 && <div className="flex flex-wrap gap-1.5">{chips}</div>}
      {gradeChips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-chalk/35">
            Model
          </span>
          {gradeChips}
        </div>
      )}
    </div>
  );
}

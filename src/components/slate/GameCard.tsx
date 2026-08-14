"use client";

import { CloudRain, Pin, Snowflake, Star, Thermometer, Ticket, Tv, Wind, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { voidBet } from "../../app/actions/bets";
import { inSlip, useBetSlip, type SlipSelection } from "../../lib/bet-slip-store";
import { betsChanged } from "../../lib/bets-changed";
import { kickParts, periodLabel } from "../../lib/kick";
import {
  pickCoverView,
  statusForBet,
  statusForPick,
  tintFor,
  type PickCoverView,
} from "../../lib/live-status";
import { RATING_SCALES, systemMargin } from "../../lib/rating-scales";
import {
  atsResult,
  fmtMoneyline,
  fmtPct,
  fmtSpread,
  fmtTotal,
  gradeModel,
  isDead,
  isFinal,
  isLive,
  headlinePick,
  lineForSide,
  liveHomeWinProb,
  modelPicks,
  ouResult,
  pickSideLabel,
  spreadMoveRead,
  upsetAlert,
  watchability,
  type GameView,
  type MyBetView,
  type MyPickView,
  type TeamView,
} from "../../lib/slate";
import { ConsensusChip, EdgeChip, LiveBadge, LiveStatusChip, MoveIndicator, PickedChip, ResultChip } from "./chips";
import { Football, LiveSituation } from "./LiveSituation";
import { SheetLine } from "./SheetLine";
import { TeamScoreLine } from "./TeamLine";
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
  /** Multi-game focus mode: pinned to the Focus row at the top of the slate */
  focused?: boolean;
  onFocus?: (gameId: number) => void;
  /** Sample data: the game id is invented, so the card does not link out. */
  demo?: boolean;
}

/**
 * Pull a team colour toward the card surface so the aura reads as tinted
 * material rather than as a verdict. Keeps enough hue for Michigan to look navy
 * and Texas burnt orange, without letting a Bama/Georgia card fake a losing bet.
 */
const muted = (color: string): string => `color-mix(in srgb, ${color} 55%, var(--surface))`;

function underTwo(period: number | null, clock: string | null): boolean {
  if ((period !== 2 && period !== 4) || !clock) return false;
  const m = /^(\d+):\d\d$/.exec(clock);
  return m !== null && Number(m[1]) < 2;
}

export function GameCard({
  game,
  tz,
  starred,
  onStar,
  index = 0,
  featured = false,
  focused = false,
  onFocus,
  demo = false,
}: Props) {
  const live = isLive(game);
  const final = isFinal(game);
  const dead = isDead(game);

  // score pop + team-colored flash when a live score ticks
  const prev = useRef<{ h: number | null; a: number | null }>({
    h: game.homePoints,
    a: game.awayPoints,
  });
  const [flash, setFlash] = useState<{ side: "home" | "away"; key: number } | null>(null);
  /* The same tick also swells the aura — see the flare rule in globals.css. Held
     as a timestamp rather than a boolean so a second score inside the window
     restarts the timer instead of dropping the card back to rest mid-drive. */
  const [flare, setFlare] = useState(0);
  useEffect(() => {
    const p = prev.current;
    const homeScored = game.homePoints !== p.h && game.homePoints !== null && p.h !== null;
    const awayScored = game.awayPoints !== p.a && game.awayPoints !== null && p.a !== null;
    if (homeScored) setFlash({ side: "home", key: Date.now() });
    else if (awayScored) setFlash({ side: "away", key: Date.now() });
    if (homeScored || awayScored) setFlare(Date.now());
    prev.current = { h: game.homePoints, a: game.awayPoints };
  }, [game.homePoints, game.awayPoints]);

  useEffect(() => {
    if (!flare) return;
    const t = setTimeout(() => setFlare(0), 1600);
    return () => clearTimeout(t);
  }, [flare]);

  const headline = headlinePick(game.myPicks);
  const cover =
    live && headline
      ? pickCoverView(
          headline.market,
          headline.side,
          headline.line,
          game.homePoints ?? 0,
          game.awayPoints ?? 0,
        )
      : null;

  const homeColor = game.home.color ?? "var(--push)";
  const awayColor = game.away.color ?? "var(--push)";

  /* The aura carries one fact: is your money good? Green covering, red not,
     amber only when the game sits exactly on your number — and when you have
     nothing on the game, the two team colours instead. A live game glows
     hardest; a final barely at all.

     Team colours are muted toward the surface first. Plenty of schools wear a
     red or a green (Alabama and Georgia are both red, so that card would wash a
     single flat red), and at a glance down the slate that is indistinguishable
     from "your bet is losing". Full saturation therefore belongs to the verdict
     colours alone; team colours read as tinted material, not as signal. */
  const tint = tintFor(game);
  const position = tint !== "teams";
  const auraColors =
    tint === "covering"
      ? ["var(--win)", "var(--win)"]
      : tint === "losing"
        ? ["var(--loss)", "var(--loss)"]
        : tint === "push"
          ? ["var(--accent)", "var(--accent)"]
          : [muted(awayColor), muted(homeColor)];
  /* Verdicts are loud while they can still change and fade once settled. Team
     colours sit lower — they're identity, not news — and the gap between the
     two is the point: a glance down the slate should find the verdict glows
     before anything else. (0.42/0.36 was tried first and the six-hundredths
     gap was invisible; the verdict now sits a third above the wallpaper.) */
  const auraStrength = dead
    ? 0
    : position
      ? live
        ? 0.55
        : 0.2
      : final
        ? 0.14
        : 0.3;

  return (
    <div
      className="glass-wrap"
      data-tint={position ? "position" : "teams"}
      /* Deliberately narrower than .score-pop, which fires on every card: only a
         game you have money on gets the aura reaction, or the money cue leaks. */
      data-flare={position && flare ? "1" : undefined}
      style={{ "--aura-strength": auraStrength } as React.CSSProperties}
    >
      <div className="glass-aura" aria-hidden>
        <span className="aura-a" style={{ background: auraColors[0] }} />
        <span className="aura-b" style={{ background: auraColors[1] }} />
      </div>
      <article
        className={`card card-hover card-in relative overflow-hidden ${live ? "card-live" : ""} ${
          cover?.tier === "push" ? "card-push" : ""
        } ${final && !featured ? "card-final" : ""} ${featured ? "ring-1 ring-accent/40" : ""}`}
        style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
      >
      {cover ? (
        <CoverStrip cover={cover} pick={pickPrefix(game)} />
      ) : (
        /* team-color split accent edge */
        <div aria-hidden className="absolute inset-x-0 top-0 flex h-[3px]">
          <span className="flex-1" style={{ background: awayColor }} />
          <span className="flex-1" style={{ background: homeColor }} />
        </div>
      )}

      {/* The whole card is the target — except on the demo, where the id is
          invented and following it lands on a game page for a game that does
          not exist. Everything else on the card (odds, star, pin, the slip)
          still works there; only the way out is gone. */}
      {!demo && (
        <Link
          href={`/game/${game.id}`}
          aria-label={`${game.away.school} at ${game.home.school}`}
          className="absolute inset-0 z-0 rounded-[12px] focus-visible:outline-2 focus-visible:outline-accent"
        />
      )}

      <div
        className={`pointer-events-none relative z-10 flex h-full flex-col p-3.5 ${cover ? "pt-2.5" : "pt-4"}`}
      >
        <CardHeader
          game={game}
          tz={tz}
          live={live}
          final={final}
          dead={dead}
          featured={featured}
          focused={focused}
          onFocus={onFocus}
        />

        {/* score changes on games you have action on are announced to screen
            readers; this region persists across score re-renders */}
        {live && headline && (
          <p className="sr-only" aria-live="polite">
            {game.away.abbr} {game.awayPoints ?? 0}, {game.home.abbr} {game.homePoints ?? 0},{" "}
            {periodLabel(game.period)}
          </p>
        )}

        <div key={game.status} className="fade-swap flex flex-1 flex-col">
          {!live && !final && !dead && <OddsColumnLabels game={game} />}
          <div className="mt-2 flex flex-col gap-1.5">
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

          {live && <LiveSituation game={game} />}
          {live && <CrewLine game={game} />}

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
    </div>
  );
}

/* ---- cover strip -------------------------------------------------------- */

/**
 * The verdict on a live card with a pick. The word says which side of the number
 * you're on; the tier's colour says how close it is, amber meaning one score
 * flips it. pointer-events stay off so taps fall through to the card link.
 */
function CoverStrip({ cover, pick }: { cover: PickCoverView; pick: string }) {
  return (
    <div className={`cover-strip relative z-10 pointer-events-none cover-${cover.tier}`}>
      <span className="cover-word">{cover.word}</span>
      {/* the margin earns its place only when the number is in doubt */}
      {cover.margin && <span className="cover-margin">{cover.margin}</span>}
      {cover.sub && <span className="cover-sub">{cover.sub}</span>}
      <span className="cover-pick">Pick {pick}</span>
    </div>
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
  focused,
  onFocus,
}: {
  game: GameView;
  tz: string;
  live: boolean;
  final: boolean;
  dead: boolean;
  featured: boolean;
  focused: boolean;
  onFocus?: (gameId: number) => void;
}) {
  const u2m = live && underTwo(game.period, game.clock);
  return (
    <div className="flex min-h-5 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {featured && <span className="chip bg-accent/15 text-accent">Game of the Week</span>}
        {game.rivalry && (
          <span
            className="chip shrink-0 bg-chalk/10 text-chalk"
            title={
              game.rivalry.trophy
                ? `${game.rivalry.name} · ${game.rivalry.trophy}`
                : game.rivalry.name
            }
          >
            {game.rivalry.name}
          </span>
        )}
        {live ? (
          <>
            <LiveBadge />
            <span className={`stat text-xs font-semibold ${u2m ? "u2m" : "text-chalk"}`}>
              {periodLabel(game.period)}
              {game.clock ? ` · ${game.clock}` : ""}
            </span>
            {upsetAlert(game) && (
              <span className="chip live-dot bg-loss/15 text-loss">Upset alert</span>
            )}
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
          <span className="stat flex shrink-0 items-center gap-1 text-[11px] font-medium text-dim">
            <Tv size={12} aria-hidden />
            {game.tv}
          </span>
        )}
        {onFocus && !final && !dead && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onFocus(game.id);
            }}
            aria-label={focused ? "Remove from focus row" : "Pin to focus row"}
            aria-pressed={focused}
            title={focused ? "Unpin from Focus" : "Pin to Focus (max 4)"}
            className={`pointer-events-auto -m-1 shrink-0 rounded p-1 transition-colors ${
              focused ? "text-accent" : "text-chalk/25 hover:text-chalk/60"
            }`}
          >
            <Pin size={13} fill={focused ? "currentColor" : "none"} aria-hidden />
          </button>
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

/**
 * Conditions. Wind, rain and cold still get their own icon and the accent
 * colour, because those change how a game is played; otherwise the
 * temperature shows plainly, so the card answers "what's it like there?"
 * rather than staying silent on a pleasant day.
 */
function WeatherFlag({ game }: { game: GameView }) {
  const w = game.weather;
  if (!w || game.dome || isFinal(game)) return null;
  const windy = (w.windMph ?? 0) >= 15;
  const wet = (w.precipProb ?? 0) >= 50;
  const cold = w.tempF !== null && w.tempF <= 25;
  const notable = windy || wet || cold;
  if (!notable && w.tempF === null) return null;
  const Icon = windy ? Wind : wet ? CloudRain : cold ? Snowflake : Thermometer;
  const label = windy
    ? `Wind ${Math.round(w.windMph!)} mph`
    : wet
      ? `${Math.round(w.precipProb!)}% precip`
      : `${Math.round(w.tempF!)}°F`;
  return (
    <span
      className={`stat flex shrink-0 items-center gap-1 text-[11px] ${
        notable ? "text-edge" : "text-dim"
      }`}
      title={label}
    >
      <Icon size={12} aria-hidden />
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
  const isStarred = starred.includes(team.id);

  // The mark / name / rank / score construction is shared with the home hub —
  // see TeamScoreLine. What stays here is what only a card has: the star
  // button, the possession football, the score-flash and the odds cells.
  return (
    <TeamScoreLine
      team={team}
      score={points}
      showScore={showScore}
      dimmed={lost}
      trailing={
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onStar(team.id);
            }}
            aria-label={isStarred ? `Unstar ${team.school}` : `Star ${team.school}`}
            aria-pressed={isStarred}
            className={`pointer-events-auto -m-1.5 shrink-0 rounded p-1.5 transition-colors ${
              isStarred ? "text-accent" : "text-chalk/25 hover:text-chalk/60"
            }`}
          >
            <Star size={13} fill={isStarred ? "currentColor" : "none"} aria-hidden />
          </button>
        }
      right={
        showScore ? (
          <span className="flex shrink-0 items-center gap-2">
            {live && game.possession === side && (
              <Football label={`${team.school} has possession`} />
            )}
            <span
              key={flash && flash.side === side ? flash.key : side}
              className={`stat w-11 text-right text-[24px] font-semibold leading-none ${
                lost ? "text-dim" : "text-chalk"
              } ${flash && flash.side === side ? "score-pop" : ""}`}
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
        )
      }
    />
  );
}

/* ---- crew standing ------------------------------------------------------ */

/** "OSU" / "MICH" / "Over" / "Under" for a pick side on this game. */
function sideLabel(g: GameView, side: string): string {
  if (side === "home") return g.home.abbr;
  if (side === "away") return g.away.abbr;
  return side === "over" ? "Over" : "Under";
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * Who else is riding this game, and how their week is going. With a pick of
 * your own, the line splits into "with you" and the fade; without one it
 * shows the crew's split.
 */
function CrewLine({ game }: { game: GameView }) {
  const crew = game.crewPicks;
  if (crew.length === 0) return null;
  const my = headlinePick(game.myPicks);

  if (!my) {
    const counts = new Map<string, number>();
    for (const c of crew) counts.set(c.side, (counts.get(c.side) ?? 0) + 1);
    return (
      <div className="mt-2 flex items-center gap-1.5 border-t border-chalk/8 pt-2 text-[11px] text-dim">
        <span className="stat truncate">
          Crew: {[...counts.entries()].map(([s, n]) => `${n} ${sideLabel(game, s)}`).join(" · ")}
        </span>
      </div>
    );
  }

  const pickTeam = my.side === "home" ? game.home : my.side === "away" ? game.away : null;
  const withMe = crew.filter((c) => c.side === my.side);
  const against = crew.filter((c) => c.side !== my.side);
  return (
    <div className="mt-2 flex items-center gap-1.5 border-t border-chalk/8 pt-2 text-[11px] text-dim">
      {withMe.length > 0 && (
        <span className="flex shrink-0" aria-hidden>
          {withMe.map((c) => (
            <span
              key={c.name}
              title={c.record ? `${c.name} ${c.record}` : c.name}
              className="stat -ml-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[8px] font-bold text-chalk first:ml-0"
              style={{
                background: `color-mix(in srgb, ${pickTeam?.color ?? "var(--push)"} 32%, var(--elev))`,
                borderColor: `color-mix(in srgb, ${pickTeam?.color ?? "var(--push)"} 60%, transparent)`,
              }}
            >
              {initials(c.name)}
            </span>
          ))}
        </span>
      )}
      <span className="truncate">
        {withMe.length === 0
          ? "Only you on this side"
          : `${withMe.map((c) => `${c.name}${c.record ? ` ${c.record}` : ""}`).join(" · ")} with you`}
      </span>
      {against.length > 0 && (
        <span className="ml-auto shrink-0 truncate text-chalk/55">
          {against.map((c) => `${c.name} ${sideLabel(game, c.side)}`).join(", ")}
        </span>
      )}
    </div>
  );
}

/** Column labels above the tappable odds grid — right-aligned over the cells. */
function OddsColumnLabels({ game }: { game: GameView }) {
  const { spread, total, mlHome, mlAway } = game.lines;
  if (spread === null && total === null && mlHome === null && mlAway === null) return null;
  return (
    /* widths track the cells below them — see OddsCell */
    <div className="mt-2 flex justify-end gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-chalk/55">
      <span className="w-11 text-center">Spread</span>
      <span className="w-11 text-center">Total</span>
      <span className="w-12 text-center">Money</span>
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
  /**
   * Do you have MONEY on this exact cell?
   *
   * The only question the odds grid asks. It used to also mark the cell you
   * took in the pool, which put a pick'em pick and a logged bet in nearly the
   * same amber on the same control — so a card with a pool pick and no money
   * read as a card with money on it. The pool's answer lives one row down, in
   * the chips, where it is labelled.
   */
  const betOn = (betType: MyBetView["betType"], betSide: string) =>
    game.myBets.some((b) => b.betType === betType && b.side === betSide);
  const matchup = `${game.away.abbr} @ ${game.home.abbr}`;
  const { spread, total, mlHome, mlAway } = game.lines;
  const teamSpread = spread === null ? null : side === "home" ? spread : -spread;
  const ml = side === "home" ? mlHome : mlAway;
  const totalSide = side === "home" ? ("under" as const) : ("over" as const);
  // lowercase and unspaced, the way a book prints it: five characters fit the
  // pinned cell where six do not, and a lowercase o never reads as a zero
  const totalLabel = total === null ? "–" : `${side === "home" ? "u" : "o"}${fmtTotal(total)}`;
  if (spread === null && total === null && ml === null)
    return <span className="stat text-[11px] text-chalk/30">no line</span>;

  const sel = (
    betType: SlipSelection["betType"],
    selSide: SlipSelection["side"],
    label: string,
    description: string,
    line: number | null,
    odds: number,
  ): SlipSelection => ({
    gameId: game.id,
    betType,
    side: selSide,
    label,
    matchup,
    description,
    line,
    odds,
    kickTs: game.startTs,
    // Carried for the image share's logos; the card falls back to the abbr
    // monogram when a logo is null, the same way TeamMark does on screen.
    away: { abbr: game.away.abbr, logo: game.away.logo, color: game.away.color },
    home: { abbr: game.home.abbr, logo: game.home.logo, color: game.home.color },
    tier: "bet",
  });

  return (
    <div className="flex shrink-0 gap-1">
      <OddsCell
        value={fmtSpread(teamSpread)}
        active={inSlip(slip, game.id, "spread", side)}
        bet={betOn("spread", side)}
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
        bet={betOn("total", totalSide)}
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
        bet={betOn("moneyline", side)}
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

/**
 * One odds cell, carrying two different states that must not be confused.
 *
 * `active` means it is in the bet slip right now — a transient action, so it
 * gets the solid fill. `picked` means it is the side you took in the group
 * you're viewing — a standing fact, so it gets the quieter tinted-and-ringed
 * treatment the PickedChip already uses for the same idea. Slip wins when both
 * are true, because the fill is about what you are doing this second.
 *
 * This is what lets a card say which side you're on without being opened: the
 * pregame state used to render a content-free "Picked" badge and nothing else.
 */
function OddsCell({
  value,
  active,
  bet = false,
  disabled,
  aria,
  onToggle,
  wide = false,
}: {
  value: string;
  active: boolean;
  /** A logged ledger bet sits on this cell. The only state this grid marks:
   *  pool picks are the chips below, not a treatment on the odds. */
  bet?: boolean;
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
      /* 44px tall: the readable size, and the tap-target floor docs/DESIGN.md
         sets — these were 32px, which the audit flagged as under-sized. */
      className={`stat pointer-events-auto relative flex h-11 w-11 shrink-0 items-center justify-center rounded-md px-0.5 text-[13px] font-semibold transition-colors ${
        wide ? "w-12" : ""
      } ${
        active
          ? "bg-accent text-accent-ink ring-1 ring-inset ring-accent"
          : bet
            ? "bg-accent/15 text-accent ring-1 ring-inset ring-accent"
            : "bg-elev text-chalk ring-1 ring-inset ring-chalk/8 hover:ring-accent/60"
      } disabled:cursor-default disabled:opacity-40 disabled:hover:ring-chalk/8`}
    >
      {/* Colour is never the only carrier (docs/DESIGN.md): money also gets a
          corner pip, so "I have a bet here" survives a colourblind read and a
          bright phone in the sun. */}
      {bet && !active && (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent"
        />
      )}
      {value}
    </button>
  );
}

/** Pregame crew split, shown once the viewer has locked a pick of their own. */
function CrewSplit({ game }: { game: GameView }) {
  const counts = new Map<string, number>();
  for (const c of game.crewPicks) counts.set(c.side, (counts.get(c.side) ?? 0) + 1);
  const my = headlinePick(game.myPicks);
  if (my) counts.set(my.side, (counts.get(my.side) ?? 0) + 1);
  if (game.crewPicks.length === 0) return null;
  return (
    <span className="stat min-w-0 truncate text-[10.5px] text-dim">
      {[...counts.entries()].map(([s, n]) => `${n} ${sideLabel(game, s)}`).join(" · ")}
    </span>
  );
}

/* ---- footers ----------------------------------------------------------- */

/**
 * The watch rating, said out loud.
 *
 * It used to render as `watch 78` at 11px with its scale reachable only
 * through a `title` tooltip, which a phone cannot show. A number needs a
 * scale; a word does not — so the band is what makes it self-explanatory, and
 * the figure is what makes it sortable. Bands follow the anchors the formula
 * is already tested against (slate.test.ts: a marquee game scores 80+).
 *
 * Live cards don't get it. Once the game is playing, how watchable it was
 * always going to be is beside the point — the score is on the card, and the
 * cover strip owns that size.
 */
function WatchRating({ score }: { score: number | null }) {
  if (score === null) return null;
  const band = score >= 80 ? "Must-see" : score >= 60 ? "Good" : "Filler";
  return (
    <span
      /* One chip in the row, not a three-line stack in its own column: the
         old block put an 18px figure and two labels down the right edge of
         every pregame card, which is a lot of card for a number nobody acts
         on. The band is the read; the figure rides along for sorting. */
      className={`chip ${score >= 80 ? "bg-accent/12 text-accent" : "bg-elev text-chalk/60"}`}
      role="img"
      aria-label={`Watchability ${score} out of 100 — ${band}`}
    >
      <span aria-hidden>
        {band}
        <span className="stat ml-1 opacity-60">{score}</span>
      </span>
    </span>
  );
}


/**
 * A logged bet, pregame: what you have on this game and a way out of it.
 *
 * The ledger is append-only, so "remove" is a void — the row survives, marked.
 * It lives here because a bet placed from the slate could only be undone by
 * navigating to the ledger and finding it, which nobody was going to do after
 * a mis-tap. The chip hides itself immediately and the refetch confirms — it
 * used to wait on the poll, so an in-flight one could bring the chip back.
 */
function BetChip({ bet, label }: { bet: MyBetView; label: string }) {
  const [gone, setGone] = useState(false);
  const [pending, startTransition] = useTransition();
  if (gone) return null;
  return (
    <span className="chip pointer-events-auto bg-accent/15 text-accent ring-1 ring-inset ring-accent">
      <Ticket size={10} aria-hidden className="shrink-0" />
      <span className="sr-only">Logged bet: </span>
      {label}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!confirm(`Void this bet (${label})? It stays on the ledger, marked void.`)) return;
          setGone(true);
          startTransition(() => voidBet(bet.id).then(() => betsChanged()));
        }}
        disabled={pending}
        aria-label={`Void bet ${label}`}
        className="-mr-0.5 ml-0.5 rounded p-0.5 text-accent/60 transition-colors hover:text-loss"
      >
        <X size={11} aria-hidden />
      </button>
    </span>
  );
}

/** "OSU -3.5" / "O 54.5" / "OSU ML" — the one formatter all three card states share. */
function pickPrefix(g: GameView, p: MyPickView | null = headlinePick(g.myPicks)): string {
  if (!p) return "";
  return pickSideLabel(p.market, p.side, p.line, g.home.abbr, g.away.abbr, { compact: true });
}

function betPrefix(g: GameView, b: MyBetView): string {
  const team = b.side === "home" ? g.home : g.away;
  // stored home-perspective; the ticket reads the side's number
  if (b.betType === "spread") return `${team.abbr} ${fmtSpread(lineForSide(b.side ?? "home", b.line))}`;
  if (b.betType === "total") return `${b.side === "over" ? "O" : "U"} ${fmtTotal(b.line)}`;
  return `${team.abbr} ML`;
}

function PregameFooter({ game, live }: { game: GameView; live: boolean }) {
  const final = isFinal(game);
  const p = game.prediction;
  const picks = modelPicks(game);
  const move = spreadMoveRead(game);
  const watch = watchability(game);

  const liveProb = live ? liveHomeWinProb(game) : null;
  const h = game.homePoints ?? 0;
  const a = game.awayPoints ?? 0;
  // Money on the game shows in every state, not just live: pregame it says
  // what you have on it (the ledger and the pool are separate things and a
  // card has to say both), live it sweats, final it settles. Before this it
  // rendered only while the game was playing, so a placed bet was invisible
  // on the slate right up until kickoff.
  const settled = live || final;
  const betStatuses = game.myBets.map((b) => ({
    bet: b,
    status: settled ? statusForBet(b, h, a) : null,
  }));

  return (
    <div className="mt-3 border-t border-chalk/8 pt-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* Your side leads the row: it is the one thing on a pregame card
              that is about you rather than about the game. */}
          {!live &&
            game.myPicks.map((mp) => (
              <PickedChip key={mp.market} label={pickPrefix(game, mp)} />
            ))}
          {!settled &&
            betStatuses
              .filter(({ bet }) => !bet.result)
              .map(({ bet }) => (
                <BetChip key={bet.id} bet={bet} label={betPrefix(game, bet)} />
              ))}
          <EdgeChip flag={p?.edgeFlag ?? null} edge={p?.edge ?? null} />
          <ConsensusChip on={p?.consensus ?? false} />
          <MoveIndicator move={move} open={game.lines.spreadOpen} />
          {!live && <WatchRating score={watch} />}
          {!live && game.myPicks.length > 0 && <CrewSplit game={game} />}
        </div>
      </div>

      {/* The money layer, under the pool layer and visibly separate from it:
          who in the betting group is on this game and who put it up first.
          Renders in every state — a settled sheet is how the group finds out
          whether tailing Jeff was a good idea. */}
      <SheetLine game={game} />

      {settled && betStatuses.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {betStatuses.map(({ bet, status }) =>
            status === null ? null : live ? (
              <LiveStatusChip key={bet.id} prefix={betPrefix(game, bet)} status={status} />
            ) : (
              <ResultChip
                key={bet.id}
                label={betPrefix(game, bet)}
                /* The grader's word wins once it has one; recomputing from the
                   score agrees for spread/total/ML and says nothing for the
                   types it settles by hand. */
                result={
                  bet.result === "win" || bet.result === "loss" || bet.result === "push"
                    ? bet.result === "win"
                      ? "pass"
                      : bet.result === "loss"
                        ? "fail"
                        : "push"
                    : status.state === "winning"
                      ? "pass"
                      : status.state === "losing"
                        ? "fail"
                        : "push"
                }
              />
            ),
          )}
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
              /* Totals display re-enabled after the 2023–25 calibration run
                 (model MAE 13.09 vs constant 13.72). O/U leans stay off —
                 50.8%/51.9% doesn't clear the 52.4% vig, so the total is
                 information, never a recommendation. */
              <>
                {"Model: "}
                <span className="text-chalk">
                  {game.home.abbr} {fmtSpread(Math.round(p!.spread * 10) / 10)}
                </span>
                {p!.total !== null && (
                  <>
                    {" · "}
                    <span className="text-chalk">total {fmtTotal(Math.round(p!.total * 2) / 2)}</span>
                  </>
                )}
                {picks.atsSide && (
                  <>
                    {" · "}
                    <span className="text-chalk">
                      {picks.atsSide === "home" ? game.home.abbr : game.away.abbr} ATS
                    </span>
                  </>
                )}
                {!p!.frozen && <span className="text-chalk/40"> · unfrozen</span>}
              </>
            )}
          </p>
          <SystemsRow game={game} />
        </div>
      )}
    </div>
  );
}

/**
 * SP+, FPI and Elo beside the model's own number — spec §2.4 promises "all
 * four systems side by side on every game card", and they have been synced
 * (migration 0016) and used by the consensus flag without ever being shown
 * here. Rendered in the market's convention, home-relative, so they read
 * against the spread directly above them.
 */
function SystemsRow({ game }: { game: GameView }) {
  if (game.systems.length === 0) return null;
  return (
    <p className="stat mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] leading-none text-dim">
      {game.systems.map((s) => {
        // Elo is not a points scale; the conversion lives in rating-scales,
        // beside the reason it is needed.
        const margin = systemMargin(s.system, s.home, s.away);
        return (
          <span key={s.system}>
            {RATING_SCALES[s.system].label}{" "}
            <span className="text-chalk/75">
              {margin === null ? "–" : fmtSpread(Math.round(margin * 10) / 10)}
            </span>
          </span>
        );
      })}
    </p>
  );
}

function FinalFooter({ game }: { game: GameView }) {
  const ou = ouResult(game);
  // The model only answers for frozen (receipts) rows — an unfrozen price can
  // move after the fact and grading it would be revisionism (audit #12).
  const grade = game.prediction?.frozen
    ? gradeModel(game)
    : { winner: null, ats: null, total: null };
  const { spread } = game.lines;

  // the viewer's pick, resolved: if-the-game-ended-now at the final score IS the result
  const finalPick = headlinePick(game.myPicks);
  const pickStatus =
    finalPick && game.homePoints !== null && game.awayPoints !== null
      ? statusForPick(
          finalPick.market,
          finalPick.side,
          finalPick.line,
          game.homePoints,
          game.awayPoints,
        )
      : null;

  // favorite by closing line; cover chip judges whether the favorite covered
  const favorite: "home" | "away" | null =
    spread === null ? null : spread < 0 ? "home" : spread > 0 ? "away" : null;
  const favTeam = favorite === "home" ? game.home : game.away;
  const favSpread = spread === null ? null : favorite === "home" ? spread : -spread;
  const cover = favorite ? atsResult(game) : null;

  const chips: React.ReactNode[] = [];
  if (pickStatus) {
    chips.push(
      <ResultChip
        key="pick"
        label={`Pick ${pickPrefix(game)}`}
        result={pickStatus.state === "winning" ? "pass" : pickStatus.state === "losing" ? "fail" : "push"}
      />,
    );
  }
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
  // No model O/U chip: the model doesn't price totals yet (audit #4).

  if (chips.length === 0 && gradeChips.length === 0) return null;

  return (
    <div className="mt-3 border-t border-chalk/8 pt-2.5">
      {chips.length > 0 && <div className="flex flex-wrap gap-1.5">{chips}</div>}
      {gradeChips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* /50 not /35: this label is load-bearing at 10px (audit UX-06) */}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-chalk/50">
            Model
          </span>
          {gradeChips}
        </div>
      )}
    </div>
  );
}

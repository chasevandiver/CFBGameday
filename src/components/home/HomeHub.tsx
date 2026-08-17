import { ArrowRight, ClipboardList, Ticket, Tv, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LiveBadge, LiveStatusChip, PickedChip, ResultChip } from "../slate/chips";
import { CoverStrip } from "../slate/CoverStrip";
import { LiveSituation } from "../slate/LiveSituation";
import { TeamScoreLine } from "../slate/TeamLine";
import { StatTile } from "../StatTile";
import { UnitsCurve } from "../UnitsCurve";
import { heldVsNow, splitPositions, type GroupStanding, type HomeBet, type HomeData, type HomePick, type Position, type WeekProgress } from "../../lib/home";
import type { TodayBlock } from "../../lib/home-today";
import { DEFAULT_TZ, kickParts, periodLabel, tzLabel } from "../../lib/kick";
import { statusForBet, statusForPick, tintFor } from "../../lib/live-status";
import { cardStake } from "../../lib/stake";
import { formatRecord, type Tally } from "../../lib/records";
import { betSideLabel, pickSideLabel, type GameView } from "../../lib/slate";

/**
 * The home hub's furniture.
 *
 * Presentation only, and in a component file rather than in the page, for the
 * same reason `group/GroupHub.tsx` is: the hub needs a database, a season, a
 * group, picks and bets before it draws a single pixel, so `/slate/preview`
 * renders these against sample data instead.
 *
 * Everything here is assembled from parts that already exist — `TeamLine`
 * identifies a team, `chips.tsx` says what a position is doing, `records.ts`
 * does the arithmetic. The hub is a new question, not a new vocabulary.
 */

/* ---- the hero ---------------------------------------------------------- */

/**
 * What you have going on, and the way to the slate.
 *
 * The one glowing element on the page. `GroupHub`'s `WeekHero` claims the same
 * licence for a group's week and for the same reason: a hub gets one card that
 * says "here is the thing", and everything below it is a list.
 *
 * The largest number is how many games you have something riding on, because
 * that is the question someone opening this at noon on a Saturday is asking.
 * Signed out there is no such number, so the week's size stands in — the page
 * still has to say what day it is.
 */
/**
 * A link that goes inert on the demo screens.
 *
 * Every href on this hub points at a real route — `/game/:id`, `/groups/:slug`,
 * `/ledger` — and on `/demo` every one of them is a dead end: the game ids are
 * invented, and a signed-out visitor who follows one lands on exactly the
 * sign-in card the demo exists to avoid. Rendering the same box without the
 * anchor keeps the layout identical to the real hub and stops the demo
 * promising a screen it cannot show.
 */
function MaybeLink({
  href,
  inert,
  className,
  children,
}: {
  href: string;
  inert: boolean;
  className: string;
  children: ReactNode;
}) {
  if (inert) return <div className={className}>{children}</div>;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/**
 * The day-aware strip (R2-B1): one line answering the day's question, above
 * the hero. `planToday` (src/lib/home-today.ts) decides which; this renders
 * it. A quiet day renders nothing — the hub must not grow a box of filler.
 */
export function TodayCard({
  today,
  tz = DEFAULT_TZ,
  demo = false,
}: {
  today: TodayBlock;
  tz?: string;
  demo?: boolean;
}) {
  if (today.kind === "quiet") return null;

  const body = (() => {
    switch (today.kind) {
      case "live":
        return {
          href: "/slate?sport=live",
          label: "Live now",
          copy: `${today.liveCount} ${today.liveCount === 1 ? "game" : "games"} playing — the board is moving.`,
        };
      case "results":
        return {
          href: "/recap",
          label: "The weekend, graded",
          copy: "Results, receipts, and who took the week.",
        };
      case "drop":
        return {
          href: "/ratings",
          label: "The Tuesday Drop",
          copy: today.hasDrop
            ? "New ratings are up — the movers, and the week’s argument."
            : "Ratings update lands today.",
        };
      case "board": {
        const owed = today.due.reduce((t, p) => t + Math.max(0, (p.target ?? 0) - p.made), 0);
        return {
          href: "/groups",
          label: "The board is open",
          copy:
            today.due.length === 0
              ? "Lines are up. Your picks are in."
              : `${owed} ${owed === 1 ? "pick" : "picks"} still open across ${today.due.length} ${today.due.length === 1 ? "pool" : "pools"}.`,
        };
      }
      case "kickoff": {
        const kick = kickParts(today.at, tz);
        return {
          href: "/slate",
          label: "Next kickoff",
          copy: `${kick.day} ${kick.time} ${tzLabel(tz)}.`,
        };
      }
    }
  })();

  return (
    <MaybeLink
      href={body.href}
      inert={demo}
      className="card mb-4 flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:border-accent/40"
    >
      <p className="min-w-0 text-sm">
        <span className="stat mr-2 text-[10px] font-semibold uppercase tracking-wider text-accent">
          {body.label}
        </span>
        <span className="text-chalk/80">{body.copy}</span>
      </p>
      <ArrowRight className="h-4 w-4 shrink-0 text-chalk/40" aria-hidden />
    </MaybeLink>
  );
}

export function HomeHero({
  week,
  positionCount,
  weekGameCount,
  liveCount,
  firstKick,
  progress,
  signedIn,
  tz = DEFAULT_TZ,
  slateHref = "/slate",
  demo = false,
}: {
  week: number;
  positionCount: number;
  weekGameCount: number;
  liveCount: number;
  firstKick: string | null;
  progress: WeekProgress[];
  signedIn: boolean;
  tz?: string;
  /** Where the primary action goes. `/demo` sends it to the demo's own slate. */
  slateHref?: string;
  /** On `/demo`, links that leave the demo render as plain text. */
  demo?: boolean;
}) {
  const kick = firstKick === null ? null : kickParts(firstKick, tz);
  const headline = signedIn ? positionCount : weekGameCount;
  const caption = signedIn
    ? positionCount === 0
      ? "nothing riding yet"
      : `${positionCount === 1 ? "game" : "games"} you’re on`
    : `${weekGameCount === 1 ? "game" : "games"} on the board`;

  return (
    <div
      className="glass-wrap"
      data-tint="position"
      style={{ "--aura-strength": 0.3 } as React.CSSProperties}
    >
      <div className="glass-aura" aria-hidden>
        <span className="aura-a" style={{ background: "var(--accent)" }} />
        <span className="aura-b" style={{ background: "var(--accent)" }} />
      </div>
      <section className="card relative overflow-hidden p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {/* The page's h1. The wordmark above is a link, not a heading, so
              without this the hub was the one screen with no top-level heading
              and its sections were h2s under nothing. */}
          <h1 className="text-lg leading-none">Week {week}</h1>
          {liveCount > 0 ? (
            <p className="stat text-[11px] text-chalk/55">
              {liveCount} {liveCount === 1 ? "game" : "games"} playing now
            </p>
          ) : (
            kick && (
              <p className="stat text-[11px] text-chalk/55">
                first kick {kick.day} {kick.time} {tzLabel(tz)}
              </p>
            )
          )}
        </div>

        <p className="mt-3 leading-none">
          <span className="scorebug text-[34px] leading-none text-chalk">{headline}</span>
          <span className="stat ml-1.5 text-sm text-dim">{caption}</span>
        </p>

        {/* One row per pool, each a full-height target: this is the shortcut to
            "go finish your picks", and an 11px line of text is not something a
            thumb can hit. */}
        {progress.length > 0 && (
          <ul className="mt-1.5 flex flex-col">
            {progress.map((p) => (
              <li key={p.slug}>
                <MaybeLink
                  href={`/groups/${p.slug}`}
                  inert={demo}
                  className={`stat flex min-h-11 items-center gap-1 text-[11px] leading-tight text-chalk/50 ${
                    demo ? "" : "hover:text-chalk"
                  }`}
                >
                  {/* A leading space inside a flex item is trimmed, so the
                      separator is spaced by `gap-1`, not by the string. */}
                  <span className="truncate text-chalk/80">{p.name}</span>
                  <span className="shrink-0">
                    {"· "}
                    {p.target === null
                      ? `${p.made} ${p.made === 1 ? "pick" : "picks"} in`
                      : p.made >= p.target
                        ? `${p.made} in — you’re set`
                        : `${p.made} of ${p.target} in`}
                  </span>
                </MaybeLink>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {/* Capped, not flex-1: on a tablet the full-width version stretched
              across the whole column and stopped reading as a button. */}
          <Link
            href={slateHref}
            className="stat inline-flex min-h-12 max-w-sm flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
          >
            Go to the slate
            <ArrowRight size={15} aria-hidden />
          </Link>
          {!signedIn && (
            <Link
              href="/login"
              className="stat inline-flex min-h-12 items-center rounded-lg border border-chalk/20 px-3.5 text-sm text-chalk hover:border-chalk/50"
            >
              Sign in
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---- your positions ---------------------------------------------------- */

/**
 * One game you have something on: the matchup, where it stands, and what you
 * hold on it.
 *
 * Both layers appear because they are different things. A pool pick is chalk
 * with the group mark; a logged bet is accent — accent means money, and a card
 * that renders the two identically cannot tell you what you have money on.
 */
export function PositionRow({
  position,
  tz = DEFAULT_TZ,
  /** Only worth naming the pool when the viewer is in more than one. */
  showPool = false,
  demo = false,
}: {
  position: Position;
  tz?: string;
  showPool?: boolean;
  /** On `/demo` the game id is invented, so the row does not link. */
  demo?: boolean;
}) {
  const { game, picks, bets } = position;
  const live = game.status === "in_progress";
  const final = game.status === "final";
  const settled = live || final;
  const showScore = live || final;
  const h = game.homePoints ?? 0;
  const a = game.awayPoints ?? 0;

  // The card's own aura logic, unchanged — `buildPositions` attaches the
  // viewer's layers to the game so `tintFor` reads them here exactly as it does
  // on the slate. A settled verdict glows; a matchup you haven't played yet
  // gets its two team colours.
  const tint = tintFor(game);
  const hasVerdict = tint !== "teams";
  const stake = cardStake(game);
  const aura =
    tint === "covering"
      ? ["var(--win)", "var(--win)"]
      : tint === "losing"
        ? ["var(--loss)", "var(--loss)"]
        : tint === "push"
          ? ["var(--accent)", "var(--accent)"]
          : [muted(game.away.color), muted(game.home.color)];

  return (
    <li
      className="glass-wrap"
      data-tint={hasVerdict ? "position" : "teams"}
      style={
        { "--aura-strength": hasVerdict ? (live ? 0.55 : 0.2) : final ? 0.1 : 0.28 } as React.CSSProperties
      }
    >
      <div className="glass-aura" aria-hidden>
        <span className="aura-a" style={{ background: aura[0] }} />
        <span className="aura-b" style={{ background: aura[1] }} />
      </div>
      <div className="card overflow-hidden">
        {/* The word for the glow. The aura above has always coloured this row
            green or red off `tintFor`; the hub never said what it was about,
            so the one screen built around "what do I have going on" answered
            it in colour alone. Same component, same vocabulary, same ordering
            (bet over pick) as the slate card. */}
        {stake && <CoverStrip cover={stake.cover} tail={stake.label} />}
        <MaybeLink
          href={`/game/${game.id}`}
          inert={demo}
          className={`block px-3 pb-2.5 ${stake ? "pt-1.5" : "pt-2"}`}
        >
          <RowHeader game={game} live={live} final={final} tz={tz} />
          {/* The slate's scoreboard, not a summary of it: each team on its own
              team-coloured rail with a 24px score at the right. */}
          <div className="mt-1.5 flex flex-col gap-1">
            {/* UX-37: who has the ball, the same marker the slate card uses.
                The data was already here — fetchHomeData goes through
                fetchSlateView — but the football lived inside FieldStrip,
                which `compact` below drops. */}
            <TeamScoreLine
              team={game.away}
              score={game.awayPoints}
              showScore={showScore}
              dimmed={final && a < h}
              hasBall={live && game.possession === "away"}
            />
            <TeamScoreLine
              team={game.home}
              score={game.homePoints}
              showScore={showScore}
              dimmed={final && h < a}
              hasBall={live && game.possession === "home"}
            />
          </div>
          {/* The same block the slate card shows, minus the field strip: a row
              on this page used to stop at "Q3 · 8:42" while the same game one
              tap away gave the down, the spot and the play. The data was
              already on the GameView; only the slate rendered it. */}
          {live && <LiveSituation game={game} compact />}
        </MaybeLink>

        <ul className="border-t border-chalk/8">
          {picks.map((p) => (
            <li key={`${p.groupId}-${p.market}`}>
              <PositionLine
                label={pickSideLabel(p.market, p.side, p.line, game.home.abbr, game.away.abbr, {
                  compact: true,
                })}
                kind="pick"
                note={showPool ? p.groupName : null}
                verdict={verdictForPick(p, settled, h, a)}
                move={heldVsNow(p.market, p.side, p.line, game.lines)}
              />
            </li>
          ))}
          {bets.map((b) => (
            <li key={b.id}>
              <PositionLine
                label={betSideLabel(b.betType, b.side, b.line, game.home.abbr, game.away.abbr)}
                kind="bet"
                note={null}
                verdict={verdictForBet(b, settled, h, a)}
                move={heldVsNow(b.betType, b.side ?? "home", b.line, game.lines)}
              />
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

/**
 * Pull a team colour toward the surface, the way `GameCard` does. Half the
 * sport wears red, and a full-chroma red glow is the slate's word for "your
 * bet is losing" — identity must not be able to fake a verdict.
 */
const muted = (color: string | null): string =>
  `color-mix(in srgb, ${color ?? "var(--push)"} 55%, var(--surface))`;

/** Live clock, Final, or the kickoff — plus the network. The card's idiom. */
function RowHeader({
  game,
  live,
  final,
  tz,
}: {
  game: GameView;
  live: boolean;
  final: boolean;
  tz: string;
}) {
  const kick = game.startTs === null ? null : kickParts(game.startTs, tz);
  return (
    <div className="flex min-h-5 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {live ? (
          <>
            <LiveBadge />
            <span className="stat text-xs font-semibold text-chalk">
              {periodLabel(game.period)}
              {game.clock ? ` · ${game.clock}` : ""}
            </span>
          </>
        ) : final ? (
          <span className="stat text-xs font-semibold uppercase tracking-wide text-dim">Final</span>
        ) : kick ? (
          <span className="stat text-xs text-dim">
            <span className="font-semibold text-chalk">{kick.day}</span> {kick.time} {tzLabel(tz)}
          </span>
        ) : (
          <span className="stat text-xs text-dim">TBD</span>
        )}
      </div>
      {game.tv && (
        <span className="stat flex shrink-0 items-center gap-1 text-[11px] font-medium text-dim">
          <Tv size={12} aria-hidden />
          {game.tv}
        </span>
      )}
    </div>
  );
}

type Verdict =
  | { kind: "live"; status: NonNullable<ReturnType<typeof statusForBet>> }
  // `label` rides along with the tone because a void and a push share the
  // neutral styling but are not the same outcome — one tied, the other never
  // happened, and "Push" on a canceled game is simply wrong.
  | { kind: "graded"; result: "pass" | "fail" | "push"; label: string }
  | null;

/**
 * The grader's word beats the live formula.
 *
 * A settled row already carries a result the Sunday job wrote at the bet's real
 * odds, including for the types a final score can't settle on its own
 * (team_total, first_half, future). Recomputing over it would replace a fact
 * with a guess.
 */
function verdictForBet(b: HomeBet, settled: boolean, h: number, a: number): Verdict {
  if (b.result) return { kind: "graded", result: chipResult(b.result), label: chipLabel(b.result) };
  if (!settled) return null;
  const status = statusForBet(b, h, a);
  return status ? { kind: "live", status } : null;
}

function verdictForPick(p: HomePick, settled: boolean, h: number, a: number): Verdict {
  if (p.result) return { kind: "graded", result: chipResult(p.result), label: chipLabel(p.result) };
  if (!settled) return null;
  const status = statusForPick(p.market, p.side, p.line, h, a);
  return status ? { kind: "live", status } : null;
}

const chipResult = (result: string): "pass" | "fail" | "push" =>
  result === "win" ? "pass" : result === "loss" ? "fail" : "push";

/** A voided wager says so. Everything else keeps the words it always had. */
const chipLabel = (result: string): string =>
  result === "win" ? "Won" : result === "loss" ? "Lost" : result === "void" ? "Void" : "Push";

/**
 * One thing you hold on this game: what it is, what it's doing, and whether the
 * number is still good.
 *
 * A line rather than a chip in a wrapping row, because a game can carry several
 * — two markets in a pool, or the same game bet twice at different numbers —
 * and those need to read as separate positions rather than as a pile.
 */
function PositionLine({
  label,
  kind,
  note,
  verdict,
  move,
}: {
  label: string;
  kind: "pick" | "bet";
  /** The pool a pick was made in — nothing for a bet, which is yours alone. */
  note: string | null;
  verdict: Verdict;
  move: ReturnType<typeof heldVsNow>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
      {kind === "pick" ? (
        <PickedChip label={label} />
      ) : (
        <span className="chip bg-accent/15 text-accent ring-1 ring-inset ring-accent">
          <Ticket size={10} aria-hidden className="shrink-0" />
          <span className="sr-only">Logged bet: </span>
          {label}
        </span>
      )}
      {note && <span className="stat text-[10.5px] text-dim">{note}</span>}
      {verdict?.kind === "live" && <LiveStatusChip prefix="" status={verdict.status} />}
      {verdict?.kind === "graded" && (
        <ResultChip label={verdict.label} result={verdict.result} />
      )}
      {move && move.now !== null && <LineMove move={move} />}
    </div>
  );
}

/**
 * Your number against the board's, and which way it went.
 *
 * Sits at the end of the line and only when there is a current number to
 * compare. The delta is the point: a green figure means you are holding
 * something better than what is available now.
 */
function LineMove({ move }: { move: NonNullable<ReturnType<typeof heldVsNow>> }) {
  const { held, now, delta, isTotal } = move;
  // Spreads carry their sign; totals are bare — the same split fmtSpread and
  // fmtTotal make everywhere else.
  const fmt = (v: number) => (isTotal ? `${v}` : v > 0 ? `+${v}` : `${v}`);
  return (
    <span className="stat ml-auto shrink-0 text-[10.5px] text-dim">
      held <span className="text-chalk">{fmt(held)}</span>
      {" · now "}
      <span className="text-chalk">{fmt(now as number)}</span>
      {delta !== null && delta !== 0 && (
        <span className={delta > 0 ? "text-win" : "text-loss"}>
          {" "}
          {/* The glyph is the non-colour cue for sighted readers; the sentence
              underneath is the one for everyone else. Announcing "up-pointing
              triangle" helps nobody. */}
          <span aria-hidden>{delta > 0 ? "▲" : "▼"}</span>
          {Math.abs(delta)}
          <span className="sr-only">
            {delta > 0 ? " better than the current number" : " worse than the current number"}
          </span>
        </span>
      )}
    </span>
  );
}

/* ---- your groups ------------------------------------------------------- */

/**
 * One group and where you sit in it.
 *
 * Units ride along for a betting group and not for a pool, which is the split
 * `/groups` already makes: a betting group's number *is* units, and a pick'em
 * pool's units are pretend money at a flat −110 that nobody keeps score with.
 */
export function GroupStandingRow({
  standing,
  demo = false,
}: {
  standing: GroupStanding;
  /** On `/demo` the group page is a dead end, so the row does not link. */
  demo?: boolean;
}) {
  const { group, place, field, tally } = standing;
  const betting = group.kind === "betting";
  return (
    <li>
      <MaybeLink
        href={`/groups/${group.slug}`}
        inert={demo}
        className={`card flex min-h-16 items-center justify-between gap-3 px-4 py-3 ${
          demo ? "" : "card-hover"
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-chalk">{group.name}</span>
          <span className="stat flex items-center gap-1.5 text-xs text-dim">
            {betting ? (
              <Ticket size={11} aria-hidden className="shrink-0 text-accent" />
            ) : (
              <ClipboardList size={11} aria-hidden className="shrink-0" />
            )}
            {betting ? "Betting sheet" : "Pick’em"}
            {place !== null && (
              <>
                {" · "}
                <span className="text-chalk">{ordinal(place)}</span> of {field}
              </>
            )}
          </span>
        </span>
        <span className="stat shrink-0 text-right">
          <span className="block text-base font-semibold text-chalk">
            {tally.decided > 0 ? formatRecord(tally) : "—"}
          </span>
          {betting && tally.decided > 0 && (
            <span
              className={`block text-[11px] leading-tight ${
                tally.units > 0 ? "text-win" : tally.units < 0 ? "text-loss" : "text-dim"
              }`}
            >
              {tally.units >= 0 ? "+" : ""}
              {tally.units.toFixed(1)}u
            </span>
          )}
          <span className="block text-[10px] uppercase tracking-wider text-chalk/40">
            {betting ? "your bets" : "this season"}
          </span>
        </span>
      </MaybeLink>
    </li>
  );
}

/** 1 → "1st". English is irregular at 11–13, which a naive rule gets wrong. */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/* ---- your record ------------------------------------------------------- */

/**
 * The season, in the ledger's own numbers.
 *
 * Money on top and pool picks on one quiet line underneath, never added
 * together: a bet has real odds and a real stake, a pick is flat −110 pretend
 * money, and summing them produces an ROI that describes nothing.
 */
export function RecordBlock({
  bets,
  picks,
  pickGroupCount,
  curve,
  demo = false,
}: {
  bets: Tally;
  picks: Tally;
  pickGroupCount: number;
  curve: number[];
  /** On `/demo` the ledger is a dead end, so the footnote is plain text. */
  demo?: boolean;
}) {
  return (
    <>
      {/* Four tiles of dashes is a question, not a season. Someone who only
          plays the pools gets the pool line and nothing to interpret. */}
      {bets.decided === 0 ? (
        <p className="text-sm text-dim">
          No bets logged yet —{" "}
          <Link href="/ledger" className="text-accent underline-offset-2 hover:underline">
            start the ledger
          </Link>
          .
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
          {/* Back to two across once this sits in the hub's right rail: four
              columns of a ~380px rail is not wide enough for "24-18-1". */}
          <StatTile label="Record" value={formatRecord(bets)} />
          <StatTile
            label="Units"
            value={`${bets.units >= 0 ? "+" : ""}${bets.units.toFixed(1)}`}
            tone={bets.units > 0 ? "gold" : bets.units < 0 ? "flag" : undefined}
          />
          <StatTile
            label="ROI"
            value={bets.roi === null ? "–" : `${(bets.roi * 100).toFixed(1)}%`}
          />
          <StatTile
            label="Avg CLV"
            value={
              bets.avgClv === null ? "–" : `${bets.avgClv > 0 ? "+" : ""}${bets.avgClv.toFixed(2)}`
            }
            tone={bets.avgClv !== null && bets.avgClv > 0 ? "gold" : undefined}
          />
        </div>
      )}

      {curve.length >= 2 && (
        <section className="card mt-3 p-4">
          <UnitsCurve points={curve} />
          <p className="mt-1.5 text-[10.5px] text-dim">
            Cumulative units, bet by bet, oldest to newest.
          </p>
        </section>
      )}

      {picks.decided > 0 && (
        <p className="stat mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
          <Users size={11} aria-hidden className="shrink-0" />
          Pool picks
          <span className="text-chalk">{formatRecord(picks)}</span>
          across {pickGroupCount} {pickGroupCount === 1 ? "group" : "groups"} —
          {demo ? (
            <span className="text-accent">counted separately</span>
          ) : (
            <Link
              href="/ledger?tab=picks"
              className="text-accent underline-offset-2 hover:underline"
            >
              counted separately
            </Link>
          )}
        </p>
      )}
    </>
  );
}

/* ---- the whole hub ------------------------------------------------------ */

/**
 * The hub, assembled: the hero, then what you have riding, then where you
 * stand.
 *
 * This lives here rather than in `app/page.tsx` so that the page is only a
 * loader — `fetchHomeData` and a session — and everything below it is
 * presentation that can be handed a `HomeData` from anywhere. `/demo` hands it
 * one made of sample data, which is the only way to show the hub to somebody
 * who has no account: signed out, the real page is a week header and a sign-in
 * card, because that is honestly all it has.
 *
 * The alternative was for the demo to re-create this layout against the same
 * components, which is what `/slate/preview` did — and a second copy of a
 * dashboard is a copy that is wrong by the second time anyone edits either one.
 *
 * The `<main>` landmark stays with the page rather than moving in here: the
 * design harness renders this inside its own `<main>`, and two of them (both
 * carrying `id="main"`, which the skip link targets) is a broken page.
 */
export function HomeDashboard({
  data,
  signedIn,
  note,
  slateHref,
  demo = false,
}: {
  data: HomeData;
  signedIn: boolean;
  /** Rendered above the hero. `/demo` puts its sample-data marker here. */
  note?: ReactNode;
  /** Where the hero's primary action goes. `/demo` keeps it inside the demo. */
  slateHref?: string;
  /**
   * Sample data: every link out of this hub is a dead end, so they render as
   * plain text instead. The one exception is the hero's own CTA, which
   * `slateHref` already points at the demo's slate.
   */
  demo?: boolean;
}) {
  const { bets: betPositions, picks: pickPositions } = splitPositions(data.positions);

  // Naming the pool on every pick is noise when there is only one to name.
  const showPool = data.groups.filter((g) => g.group.kind === "pickem").length > 1;

  return (
    <>
      {note}
      <TodayCard today={data.today} demo={demo} />
      <HomeHero
        week={data.week}
        positionCount={data.positions.length}
        weekGameCount={data.weekGameCount}
        liveCount={data.liveCount}
        firstKick={data.firstKick}
        progress={data.progress}
        signedIn={signedIn}
        slateHref={slateHref}
        demo={demo}
      />

      {!signedIn ? (
        <section className="card mt-6 px-5 py-6 text-center">
          <p className="text-sm text-chalk">This is where your Saturday lives.</p>
          <p className="mt-1 text-sm leading-relaxed text-dim">
            Sign in and this page carries the games you have money or a pick on, your groups and
            where you sit in them, and your season record.
          </p>
          {/* Two ways forward, because a signed-out visitor is one of two
              people: someone who has an account and wants past this card, and
              someone who has never seen the site and has no idea what it is.
              The second one is who /welcome was written for. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/login"
              className="stat inline-flex min-h-11 items-center rounded-lg border border-chalk/20 px-3.5 text-sm text-chalk hover:border-chalk/50"
            >
              Sign in
            </Link>
            <Link
              href="/welcome"
              className="stat inline-flex min-h-11 items-center rounded-lg px-3.5 text-sm text-accent hover:underline"
            >
              New here? What this is →
            </Link>
          </div>
        </section>
      ) : (
        /* Your action on the left, where you stand on the right — the hub is
           a column on a phone and a dashboard on anything wider. */
        <div className="mt-6 grid gap-7 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
          <div>
            {/* ---- money ---- */}
            <section aria-labelledby="bets-heading">
              <SectionHead
                id="bets-heading"
                title="Your bets"
                count={
                  betPositions.length > 0
                    ? `${data.openBetCount} open · ${data.openBetUnits.toFixed(1)}u`
                    : undefined
                }
                href={demo ? undefined : "/ledger"}
                linkLabel="Ledger"
              />
              {betPositions.length === 0 ? (
                <HubEmpty
                  line="No money on this week yet."
                  hint="Bets you log off the slate show up here, live."
                  href="/slate"
                  cta="Find a number"
                />
              ) : (
                <ul className="flex flex-col gap-3.5">
                  {betPositions.map((p) => (
                    <PositionRow key={`bet-${p.game.id}`} position={p} demo={demo} />
                  ))}
                </ul>
              )}
            </section>

            {/* ---- the pool ---- */}
            <section className="mt-7" aria-labelledby="picks-heading">
              <SectionHead
                id="picks-heading"
                title="Pool picks"
                count={data.weekPickCount > 0 ? `${data.weekPickCount} in` : undefined}
                href={demo ? undefined : "/groups"}
                linkLabel="The board"
              />
              {pickPositions.length === 0 ? (
                <HubEmpty
                  line={
                    data.progress.length === 0
                      ? "No pool board this week."
                      : "You haven’t made your picks yet."
                  }
                  hint={
                    data.progress.length === 0
                      ? "Your admin sets the games each week."
                      : "Picks save as you tap, and stay editable until each game kicks."
                  }
                  href={data.progress[0] ? `/groups/${data.progress[0].slug}/picks` : "/groups"}
                  cta={data.progress.length === 0 ? "Your groups" : "Make picks"}
                />
              ) : (
                <ul className="flex flex-col gap-3.5">
                  {pickPositions.map((p) => (
                    <PositionRow key={`pick-${p.game.id}`} position={p} showPool={showPool} demo={demo} />
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div>
            {/* ---- your groups ---- */}
            <section aria-labelledby="groups-heading">
              <SectionHead
                id="groups-heading"
                title="Your groups"
                href={demo ? undefined : "/groups"}
                linkLabel="All groups"
              />
              {data.groups.length === 0 ? (
                <HubEmpty
                  line="You’re not in a group yet."
                  hint="Create one and you’re its admin, or join with a code."
                  href="/groups"
                  cta="Start or join a group"
                />
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {data.groups.map((s) => (
                    <GroupStandingRow key={s.group.id} standing={s} demo={demo} />
                  ))}
                </ul>
              )}
            </section>

            {/* ---- your record ---- */}
            <section className="mt-7" aria-labelledby="record-heading">
              <SectionHead
                id="record-heading"
                title="Your season"
                href={demo ? undefined : "/ledger"}
                linkLabel="Full ledger"
              />
              {data.bets.decided === 0 && data.picks.decided === 0 ? (
                <HubEmpty
                  line="Nothing has graded yet."
                  hint="Record, units, ROI and CLV land here once your first bet settles."
                  href="/ledger"
                  cta="Log a bet"
                />
              ) : (
                <RecordBlock
                  bets={data.bets}
                  picks={data.picks}
                  pickGroupCount={data.pickGroupCount}
                  curve={data.curve}
                  demo={demo}
                />
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}

/* ---- shared furniture -------------------------------------------------- */

/** The section header every hub on this site uses. */
export function SectionHead({
  id,
  title,
  count,
  href,
  linkLabel,
}: {
  id: string;
  title: string;
  /** What the section holds — "6 open · 6.0u", "7 in". Omitted when empty. */
  count?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2">
      <h2 id={id} className="text-sm text-accent">
        {title}
      </h2>
      {count && <span className="stat text-[11px] text-dim">{count}</span>}
      <span className="h-px flex-1 bg-chalk/10" aria-hidden />
      {href && linkLabel && (
        <Link href={href} className="stat text-[11px] text-dim hover:text-chalk">
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}

/**
 * A block with nothing in it yet, said in a way that gives you somewhere to go.
 *
 * Every one of these is a first-run state, not an error, so none of them render
 * a dash or an empty table — a column of dashes is a question the reader has to
 * answer.
 */
export function HubEmpty({
  line,
  hint,
  href,
  cta,
}: {
  line: string;
  hint: string;
  href: string;
  cta: string;
}) {
  return (
    <section className="card px-5 py-6 text-center">
      <p className="text-sm text-chalk">{line}</p>
      <p className="mt-1 text-sm text-dim">{hint}</p>
      <Link
        href={href}
        className="stat mt-3 inline-flex min-h-11 items-center rounded-lg border border-chalk/20 px-3.5 text-sm text-chalk hover:border-chalk/50"
      >
        {cta}
      </Link>
    </section>
  );
}

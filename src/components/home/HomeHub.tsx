import { ArrowRight, ClipboardList, Ticket, Users } from "lucide-react";
import Link from "next/link";
import { LiveStatusChip, PickedChip, ResultChip } from "../slate/chips";
import { TeamLine } from "../slate/TeamLine";
import { StatTile } from "../StatTile";
import { UnitsCurve } from "../UnitsCurve";
import type { GroupStanding, HomeBet, HomePick, Position, WeekProgress } from "../../lib/home";
import { DEFAULT_TZ, kickParts, tzLabel } from "../../lib/kick";
import { statusForBet, statusForPick } from "../../lib/live-status";
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
export function HomeHero({
  week,
  positionCount,
  weekGameCount,
  liveCount,
  firstKick,
  progress,
  signedIn,
  tz = DEFAULT_TZ,
}: {
  week: number;
  positionCount: number;
  weekGameCount: number;
  liveCount: number;
  firstKick: string | null;
  progress: WeekProgress[];
  signedIn: boolean;
  tz?: string;
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
          <h2 className="text-lg leading-none">Week {week}</h2>
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
                <Link
                  href={`/groups/${p.slug}`}
                  className="stat flex min-h-11 items-center gap-1 text-[11px] leading-tight text-chalk/50 hover:text-chalk"
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
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Link
            href="/slate"
            className="stat inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
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
export function PositionRow({ position, tz = DEFAULT_TZ }: { position: Position; tz?: string }) {
  const { game, picks, bets } = position;
  const live = game.status === "in_progress";
  const final = game.status === "final";
  const settled = live || final;
  const h = game.homePoints ?? 0;
  const a = game.awayPoints ?? 0;
  const kick = game.startTs === null ? null : kickParts(game.startTs, tz);

  return (
    <li className="card overflow-hidden">
      <Link href={`/game/${game.id}`} className="flex items-start gap-2 px-3 py-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <TeamLine team={game.away} size={20} showRecord={false} />
          <TeamLine team={game.home} size={20} showRecord={false} />
        </span>
        <span className="stat shrink-0 text-right text-[10.5px] leading-tight text-dim">
          {final ? (
            <>
              Final
              {/* `a`/`h`, not the raw nullable columns: a game the scoreboard
                  marked done before the score landed would render a bare
                  en dash where a number goes. */}
              <span className="block text-chalk">
                {a}–{h}
              </span>
            </>
          ) : live ? (
            <>
              <span className="text-live">Live</span>
              <span className="block text-chalk">
                {a}–{h}
              </span>
            </>
          ) : kick ? (
            <>
              {kick.day}
              <span className="block text-chalk">
                {kick.time} {tzLabel(tz)}
              </span>
            </>
          ) : (
            "TBD"
          )}
        </span>
      </Link>

      <ul className="flex flex-wrap items-center gap-1.5 border-t border-chalk/8 px-3 py-2">
        {picks.map((p) => (
          <li key={`${p.groupId}-${p.market}`}>
            <PositionChip
              label={pickSideLabel(p.market, p.side, p.line, game.home.abbr, game.away.abbr, {
                compact: true,
              })}
              kind="pick"
              note={p.groupName}
              verdict={verdictForPick(p, game, settled, h, a)}
            />
          </li>
        ))}
        {bets.map((b) => (
          <li key={b.id}>
            <PositionChip
              label={betSideLabel(b.betType, b.side, b.line, game.home.abbr, game.away.abbr)}
              kind="bet"
              note={null}
              verdict={verdictForBet(b, settled, h, a)}
            />
          </li>
        ))}
      </ul>
    </li>
  );
}

type Verdict =
  | { kind: "live"; status: NonNullable<ReturnType<typeof statusForBet>> }
  | { kind: "graded"; result: "pass" | "fail" | "push" }
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
  if (b.result && b.result !== "void") return { kind: "graded", result: chipResult(b.result) };
  if (!settled) return null;
  const status = statusForBet(b, h, a);
  return status ? { kind: "live", status } : null;
}

function verdictForPick(
  p: HomePick,
  game: GameView,
  settled: boolean,
  h: number,
  a: number,
): Verdict {
  if (p.result && p.result !== "void") return { kind: "graded", result: chipResult(p.result) };
  if (!settled) return null;
  const status = statusForPick(p.market, p.side, p.line, h, a);
  return status ? { kind: "live", status } : null;
}

const chipResult = (result: string): "pass" | "fail" | "push" =>
  result === "win" ? "pass" : result === "loss" ? "fail" : "push";

/** Your side, plus what it's doing. Icon and text carry it; colour never alone. */
function PositionChip({
  label,
  kind,
  note,
  verdict,
}: {
  label: string;
  kind: "pick" | "bet";
  /** The pool a pick was made in — nothing for a bet, which is yours alone. */
  note: string | null;
  verdict: Verdict;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === "pick" ? (
        <PickedChip label={label} />
      ) : (
        <span className="chip bg-accent/15 text-accent ring-1 ring-inset ring-accent">
          <Ticket size={10} aria-hidden className="shrink-0" />
          <span className="sr-only">Logged bet: </span>
          {label}
        </span>
      )}
      {note && <span className="stat text-[10.5px] text-chalk/45">{note}</span>}
      {verdict?.kind === "live" && <LiveStatusChip prefix="" status={verdict.status} />}
      {verdict?.kind === "graded" && (
        <ResultChip
          label={verdict.result === "pass" ? "Won" : verdict.result === "fail" ? "Lost" : "Push"}
          result={verdict.result}
        />
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
export function GroupStandingRow({ standing }: { standing: GroupStanding }) {
  const { group, place, field, tally } = standing;
  const betting = group.kind === "betting";
  return (
    <li>
      <Link
        href={`/groups/${group.slug}`}
        className="card card-hover flex min-h-16 items-center justify-between gap-3 px-4 py-3"
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
      </Link>
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
}: {
  bets: Tally;
  picks: Tally;
  pickGroupCount: number;
  curve: number[];
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <Link
            href="/ledger?tab=picks"
            className="text-accent underline-offset-2 hover:underline"
          >
            counted separately
          </Link>
        </p>
      )}
    </>
  );
}

/* ---- shared furniture -------------------------------------------------- */

/** The section header every hub on this site uses. */
export function SectionHead({
  id,
  title,
  href,
  linkLabel,
}: {
  id: string;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2">
      <h2 id={id} className="text-sm text-accent">
        {title}
      </h2>
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

import { ArrowRight, Crown } from "lucide-react";
import Link from "next/link";
import { ShareButton } from "../ShareButton";
import type { GroupWeek } from "../../lib/groups";
import { DEFAULT_TZ, kickParts, tzLabel } from "../../lib/kick";
import { formatRecord, type Tally } from "../../lib/records";

/**
 * The group hub's two card types.
 *
 * Presentation only, and in a component file rather than in the page, so the
 * dev preview at /slate/preview can render them against sample data — the hub
 * itself needs a database, a group and a signed-in member before it will draw
 * a single pixel, which is a poor loop for design work.
 */

/**
 * The one card the hub is built around: what this week is, how far through it
 * you are, and the button that finishes it.
 *
 * It carries the liquid-glass aura the slate's cards use for a position you
 * hold — this is the group's equivalent of having money on the game, and it is
 * the only element on the page allowed to glow.
 */
export function WeekHero({
  slug,
  week,
  currentWeek,
  groupWeek,
  gameCount,
  pickSlots,
  myPickCount,
  minPicks,
  firstKick,
  isAdmin,
  signedIn,
  share,
}: {
  slug: string;
  week: number;
  currentWeek: number;
  groupWeek: GroupWeek | null;
  gameCount: number;
  /** Picks this board actually offers — games times their live markets. */
  pickSlots: number;
  myPickCount: number;
  minPicks: number;
  firstKick: string | null;
  isAdmin: boolean;
  signedIn: boolean;
  share: Parameters<typeof ShareButton>[0]["context"] | null;
}) {
  const target = minPicks > 0 ? minPicks : pickSlots;
  const done = target > 0 && myPickCount >= target;
  const pct = target > 0 ? Math.min(100, Math.round((myPickCount / target) * 100)) : 0;
  const kick = firstKick === null ? null : kickParts(firstKick, DEFAULT_TZ);

  return (
    <div className="glass-wrap" data-tint="position" style={{ "--aura-strength": 0.3 } as React.CSSProperties}>
      <div className="glass-aura" aria-hidden>
        <span className="aura-a" style={{ background: "var(--accent)" }} />
        <span className="aura-b" style={{ background: "var(--accent)" }} />
      </div>
      <section className="card relative overflow-hidden p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            {week > 1 && (
              <Link
                href={`/groups/${slug}?week=${week - 1}`}
                aria-label={`Week ${week - 1}`}
                className="stat inline-flex min-h-11 min-w-8 items-center justify-center text-sm text-dim hover:text-chalk"
              >
                ‹
              </Link>
            )}
            <h2 className="text-lg leading-none">Week {week}</h2>
            {week < 20 && (
              <Link
                href={`/groups/${slug}?week=${week + 1}`}
                aria-label={`Week ${week + 1}`}
                className="stat inline-flex min-h-11 min-w-8 items-center justify-center text-sm text-dim hover:text-chalk"
              >
                ›
              </Link>
            )}
            {week !== currentWeek && (
              <Link
                href={`/groups/${slug}`}
                className="stat text-[10.5px] uppercase tracking-wider text-accent hover:underline"
              >
                back to now
              </Link>
            )}
          </span>
          {groupWeek && (
            <p className="stat text-[11px] text-chalk/55">
              {describeFormat(groupWeek, gameCount)}
              {groupWeek.locked ? " · locked" : ""}
            </p>
          )}
        </div>

        {groupWeek === null ? (
          <div className="mt-3">
            <p className="text-sm text-chalk">Week {week} isn&rsquo;t set up yet.</p>
            <p className="mt-1 text-sm text-dim">
              {isAdmin ? (
                <Link
                  href={`/groups/${slug}/settings?week=${week}`}
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  Choose the games and bet types →
                </Link>
              ) : (
                "Your admin hasn’t picked the games yet."
              )}
            </p>
          </div>
        ) : gameCount === 0 ? (
          <p className="mt-3 text-sm text-dim">No games in play for week {week}.</p>
        ) : (
          <>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="leading-none">
                <span className="scorebug text-[34px] leading-none text-chalk">{myPickCount}</span>
                <span className="stat ml-1 text-sm text-dim">
                  {minPicks > 0
                    ? `of ${minPicks} required`
                    : `of ${pickSlots} ${pickSlots === 1 ? "pick" : "picks"}`}
                </span>
                <span className="stat mt-1 block text-[11px] text-chalk/50">
                  {done
                    ? "you’re in — change any pick until it kicks"
                    : minPicks > 0
                      ? `${minPicks - myPickCount} more to meet the minimum`
                      : `${gameCount} ${gameCount === 1 ? "game" : "games"} · saved as you tap`}
                </span>
              </p>
              {kick && (
                <p className="stat shrink-0 text-right text-[11px] leading-tight text-dim">
                  first kick
                  <span className="block text-chalk">
                    {kick.day} {kick.time} {tzLabel(DEFAULT_TZ)}
                  </span>
                </p>
              )}
            </div>

            {/* Progress, not decoration: no layout shift as it fills, and the
                number above already says it for anyone who can't see colour. */}
            <div
              aria-hidden
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-chalk/10"
            >
              <span
                className="block h-full rounded-full transition-[width] duration-300"
                style={{ width: `${pct}%`, background: done ? "var(--win)" : "var(--accent)" }}
              />
            </div>
          </>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {groupWeek !== null && gameCount > 0 && (
            <Link
              href={`/groups/${slug}/picks?week=${week}`}
              className="stat inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink sm:flex-none"
            >
              {signedIn ? (myPickCount > 0 ? "Review picks" : "Make picks") : "See the board"}
              <ArrowRight size={15} aria-hidden />
            </Link>
          )}
          <Link
            href={`/groups/${slug}/week/${week}?view=pick`}
            className="stat inline-flex min-h-11 items-center rounded-lg border border-chalk/20 px-3.5 text-sm text-chalk hover:border-chalk/50"
          >
            Who picked what
          </Link>
          {share && <ShareButton context={share} />}
        </div>
      </section>
    </div>
  );
}

/**
 * One member, in the slate's card idiom: the number you came for is the
 * largest thing in the row, everything else is a caption.
 */
export function MemberCard({
  place,
  name,
  isAdmin,
  isMe,
  tally,
  priced,
}: {
  place: number;
  name: string;
  isAdmin: boolean;
  isMe: boolean;
  tally: Tally;
  priced: boolean;
}) {
  return (
    <li
      className={`card flex items-center gap-3 px-3.5 py-2.5 ${
        isMe ? "ring-1 ring-inset ring-accent/40" : ""
      }`}
    >
      <span className="stat w-5 shrink-0 text-center text-sm text-chalk/35">{place}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-chalk">{name}</span>
          {isMe && (
            <span className="stat shrink-0 text-[10px] uppercase tracking-wider text-accent">
              you
            </span>
          )}
          {isAdmin && (
            <>
              {/* aria-label on an SVG is unreliable without role="img"; the
                  text node is what actually gets announced. */}
              <Crown size={11} aria-hidden className="shrink-0 text-chalk/35" />
              <span className="sr-only">group admin</span>
            </>
          )}
        </span>
        <span className="stat block text-[10.5px] leading-tight text-chalk/45">
          {tally.decided === 0
            ? "nothing graded yet"
            : priced
              ? `${tally.avgClv === null ? "no CLV yet" : `CLV ${tally.avgClv > 0 ? "+" : ""}${tally.avgClv.toFixed(2)}`}${
                  tally.roi === null ? "" : ` · ${(tally.roi * 100).toFixed(0)}% ROI`
                }`
              : `${tally.decided} graded`}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="stat block text-lg font-semibold leading-none text-chalk">
          {tally.decided > 0 ? formatRecord(tally) : "—"}
        </span>
        {priced && (
          <span
            className={`stat block text-[11px] leading-tight ${
              tally.units > 0 ? "text-win" : tally.units < 0 ? "text-loss" : "text-chalk/45"
            }`}
          >
            {tally.decided > 0
              ? `${tally.units >= 0 ? "+" : ""}${tally.units.toFixed(1)}u`
              : " "}
          </span>
        )}
      </span>
    </li>
  );
}


/** "8 games · spreads + totals" — the week's format in one line. */
export function describeFormat(w: GroupWeek, gameCount: number): string {
  const games =
    w.selectionMode === "full_slate"
      ? "full slate"
      : w.selectionMode === "conference"
        ? (w.conference ?? "conference")
        : `${gameCount} ${gameCount === 1 ? "game" : "games"}`;
  const markets = w.markets
    .map((m) => (m === "straight_up" ? "winners" : m === "total" ? "totals" : "spreads"))
    .join(" + ");
  return `${games} · ${markets}`;
}

"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { PickMarket } from "../../lib/db-types";
import { DEFAULT_TZ, kickParts, tzLabel } from "../../lib/kick";
import type { ShareContext } from "../../lib/share-text";
import { pickableSlots, type GameView } from "../../lib/slate";
import { PickButtons, type MyPickView } from "../PickButtons";
import { ShareButton } from "../ShareButton";
import { TeamLine } from "../slate/TeamLine";

export interface BoardEntry {
  game: GameView;
  /** The viewer's picks on this game, one per market at most. */
  myPicks: MyPickView[];
  /** How many picks the group has on this game; null when the blind hides it. */
  takers: number | null;
}

/**
 * This week's board: the games the admin put in play, and the tap targets for
 * picking them.
 *
 * Client-owned for one reason — the running count. Making picks used to end in
 * silence: no submit button, no total, and no idea where to go next, so the
 * only way to know you were done was to count the cards yourself. The footer
 * is that missing acknowledgement, and it has to move on the tap rather than on
 * the server's answer, which is why the count lives here and not in the page.
 */
export function PickBoard({
  groupId,
  slug,
  week,
  markets,
  entries,
  minPicks,
  signedIn,
  shareContext,
}: {
  groupId: string;
  slug: string;
  week: number;
  markets: PickMarket[];
  entries: BoardEntry[];
  /** League Rules #6, per group. 0 = no minimum. */
  minPicks: number;
  signedIn: boolean;
  /** Everything the share sheet needs except `justPlaced`, which is client-only. */
  shareContext: Omit<ShareContext, "justPlaced"> | null;
}) {
  // Seeded from the server, then moved by taps. `${gameId}:${market}` → side.
  const [held, setHeld] = useState<Map<string, string>>(
    () =>
      new Map(
        entries.flatMap((e) =>
          e.myPicks.map((p) => [`${e.game.id}:${p.market}`, p.side] as const),
        ),
      ),
  );

  const onPickChange = useCallback(
    (gameId: number, market: PickMarket, side: string | null) => {
      setHeld((cur) => {
        const next = new Map(cur);
        if (side === null) next.delete(`${gameId}:${market}`);
        else next.set(`${gameId}:${market}`, side);
        return next;
      });
    },
    [],
  );

  const pickCount = held.size;
  const gamesPicked = useMemo(
    () => new Set([...held.keys()].map((k) => k.split(":")[0])).size,
    [held],
  );
  // Same figure as the hub's: what this board can actually take.
  const slots = pickableSlots(entries.map((e) => e.game), markets);
  const openGames = entries.filter(
    (e) => e.game.startTs === null || new Date(e.game.startTs) > new Date(),
  ).length;

  return (
    <>
      <ul className="flex flex-col gap-3">
        {entries.map(({ game, myPicks, takers }) => (
          <BoardCard
            key={game.id}
            game={game}
            myPicks={myPicks}
            takers={takers}
            groupId={groupId}
            markets={markets}
            signedIn={signedIn}
            onPickChange={onPickChange}
          />
        ))}
      </ul>

      {/* The bottom bar: what you have in, and the way out. Sits in the thumb
          zone above the nav (docs/DESIGN.md) and is always there rather than
          appearing on the last pick — a control that materialises is a control
          nobody finds. */}
      {signedIn && (
        <div
          /* Clears the bottom nav below md, where the nav exists; above md the
             nav is `md:hidden`, so reserving 64px there would leave the bar
             floating over a dead strip. */
          className="fixed inset-x-0 bottom-0 z-20 border-t border-chalk/10 px-4 pt-2.5 backdrop-blur-xl pb-[calc(0.625rem+var(--bottom-nav-h)+env(safe-area-inset-bottom))] md:pb-[max(0.625rem,env(safe-area-inset-bottom))]"
          style={{
            background: "var(--glass-bar)",
            boxShadow: "inset 0 1px 0 var(--glass-edge)",
          }}
        >
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="stat min-w-0 flex-1 text-xs leading-tight">
              <span className="text-base font-semibold text-chalk">{pickCount}</span>
              <span className="text-dim">
                {minPicks > 0 ? ` of ${minPicks}` : ` of ${slots}`}{" "}
                {slots === 1 ? "pick" : "picks"} in
                {minPicks > 0 && pickCount < minPicks
                  ? ` · ${minPicks - pickCount} to go`
                  : minPicks > 0
                    ? " · minimum met"
                    : ""}
              </span>
              <span className="block text-[10.5px] text-chalk/45">
                {gamesPicked} of {entries.length} games
                {openGames < entries.length ? ` · ${entries.length - openGames} locked` : ""} ·
                saved as you tap
              </span>
            </p>
            {shareContext && <ShareButton context={shareContext} />}
            <Link
              href={`/groups/${slug}/week/${week}?view=person`}
              className="stat inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-ink"
            >
              {minPicks > 0 && pickCount >= minPicks && (
                <Check size={14} strokeWidth={3} aria-hidden />
              )}
              Review picks
              <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

function BoardCard({
  game,
  myPicks,
  takers,
  groupId,
  markets,
  signedIn,
  onPickChange,
}: {
  game: GameView;
  myPicks: MyPickView[];
  takers: number | null;
  groupId: string;
  markets: PickMarket[];
  signedIn: boolean;
  onPickChange: (gameId: number, market: PickMarket, side: string | null) => void;
}) {
  const kick = game.startTs === null ? null : kickParts(game.startTs, DEFAULT_TZ);
  const live = game.status === "in_progress";
  const final = game.status === "final";
  const awayColor = game.away.color ?? "var(--push)";
  const homeColor = game.home.color ?? "var(--push)";

  return (
    <li className={`card overflow-hidden ${live ? "card-live" : ""}`}>
      <div aria-hidden className="flex h-[3px]">
        <span className="flex-1" style={{ background: awayColor }} />
        <span className="flex-1" style={{ background: homeColor }} />
      </div>

      <div className="px-3 pb-3 pt-2.5">
        <div className="flex items-start gap-2">
          <Link
            href={`/game/${game.id}`}
            className="flex min-w-0 flex-1 flex-col gap-1"
            aria-label={`${game.away.school} at ${game.home.school}`}
          >
            {(["away", "home"] as const).map((side) => {
              const team = side === "away" ? game.away : game.home;
              const points = side === "away" ? game.awayPoints : game.homePoints;
              return (
                <span
                  key={side}
                  className="trow flex items-center gap-2"
                  style={{ "--tc": team.color ?? "var(--push)" } as React.CSSProperties}
                >
                  <span className="trail" aria-hidden />
                  <TeamLine team={team} size={26} name="school" className="flex-1" />
                  {(live || final) && (
                    <span className="stat w-8 shrink-0 text-right text-[17px] font-semibold leading-none text-chalk">
                      {points ?? 0}
                    </span>
                  )}
                </span>
              );
            })}
          </Link>
          <span className="stat shrink-0 pt-1 text-right text-[11px] leading-tight text-dim">
            {final ? (
              "Final"
            ) : live ? (
              <span className="text-live">Live</span>
            ) : kick ? (
              <>
                {kick.day}
                <span className="block text-chalk/70">
                  {kick.time} {tzLabel(DEFAULT_TZ)}
                </span>
              </>
            ) : (
              "TBD"
            )}
          </span>
        </div>

        <div className="mt-2.5">
          <PickButtons
            groupId={groupId}
            gameId={game.id}
            homeLabel={game.home.abbr}
            awayLabel={game.away.abbr}
            currentSpread={game.lines.spread}
            currentTotal={game.lines.total}
            markets={markets}
            myPicks={myPicks}
            kickoffPassed={game.startTs !== null && new Date(game.startTs) <= new Date()}
            kickoffTs={game.startTs}
            signedIn={signedIn}
            onPickChange={onPickChange}
            quiet
          />
        </div>

        {takers !== null && takers > 0 && (
          <p className="stat mt-1.5 text-[10.5px] text-chalk/45">
            {takers} {takers === 1 ? "pick" : "picks"} in from the group
          </p>
        )}
      </div>
    </li>
  );
}

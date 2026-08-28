"use client";

import { ArrowRight, Check, Lock, X } from "lucide-react";
import { useState, useTransition } from "react";
import { makeSurvivorPick, removeSurvivorPick } from "../../app/actions/survivor";
import type { PickBlock } from "../../lib/survivor";
import type { TeamView } from "../../lib/slate";
import { TeamMark } from "../slate/TeamMark";

export interface PickableTeam {
  team: TeamView;
  /** Null when it can be taken; otherwise why not. */
  block: PickBlock;
  /**
   * The week this team was spent in, when `block` is `used`. The ledger is the
   * whole game — "used Week 3" is an answer, "already used" only tells you to
   * go and look it up.
   */
  spentIn: string | null;
}

export interface PickableGame {
  gameId: number;
  kick: string;
  /** Kickoff has passed (or is unknown), so nothing on this card can move. */
  locked: boolean;
  away: PickableTeam;
  home: PickableTeam;
}

/**
 * This week's board for a survivor pool: every game in scope, two teams a side,
 * one of them yours.
 *
 * The refusals are spelled out rather than rendered as a uniform grey. "Used in
 * week 3" and "kicked off" are different problems with different answers, and a
 * pool's whole strategy is bookkeeping about which teams you have spent — a
 * disabled button that will not say why makes the reader keep that ledger in
 * their head.
 *
 * ## The tap has to answer back
 *
 * Selecting is a single tap with no confirm: the RPC lets you change your mind
 * until the game you are holding kicks off. What was missing was the receipt.
 * The board's only acknowledgement was a border colour on one of thirty
 * buttons, `pending` disabled *every* button on the page for the length of the
 * round-trip, and there was no equivalent of the pick'em board's bottom bar —
 * so a tap looked like it did nothing and there was nowhere to go and check.
 * Reported by the owner 2026-08-18: "I just selected one and there isn't a
 * review picks or any action item to see if the bet was confirmed."
 *
 * So, borrowing what `PickButtons` already learned (audit 08/UX-10) and what
 * `PickBoard` already renders:
 *
 * - only the tapped button carries the in-flight cue, and no button is disabled
 *   by a write that is out — the picked look lands on the tap;
 * - the card you picked says so, in words, where your thumb already is;
 * - a fixed bar in the thumb zone holds what you have in, whether it saved, and
 *   the way through to the season log.
 */
export function SurvivorPicker({
  groupId,
  week,
  seasonType,
  games,
  format,
  currentTeamIds,
  eliminated,
  reviewHref,
  forUser = null,
  forName = null,
}: {
  groupId: string;
  week: number;
  seasonType: string;
  games: PickableGame[];
  /** Classic replaces the week's one pick on each tap; extreme accumulates. */
  format: "classic" | "extreme";
  /** This week's picks — at most one in classic, any number in extreme. */
  currentTeamIds: number[];
  /** Out of the pool: the board is history now, not a control. */
  eliminated: boolean;
  /**
   * Where "Review picks" goes — the season log on this page. Null for a signed-in
   * non-member, who has a board but no log to review, and should not be handed a
   * button that scrolls nowhere.
   */
  reviewHref: string | null;
  /** A seat these taps pick for instead of the viewer (0081). */
  forUser?: string | null;
  /** The seat's name, so the bar says whose picks these are. */
  forName?: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set(currentTeamIds));
  // Which team the in-flight write is about, so one slow round-trip cannot make
  // the other twenty-nine buttons look broken.
  const [inFlight, setInFlight] = useState<number | null>(null);
  // Set by a write that came back clean. It is what turns "your pick" into
  // "saved" — the sentence the owner report was actually asking for.
  const [confirmed, setConfirmed] = useState(false);
  const busy = pending ? inFlight : null;
  const extreme = format === "extreme";

  if (eliminated) {
    return (
      <p className="card px-4 py-5 text-center text-sm text-dim">
        {forName ? `${forName} is` : "You’re"} out of this pool — the board below is everyone
        else&rsquo;s.
      </p>
    );
  }

  if (games.length === 0) {
    return (
      <p className="card px-4 py-5 text-center text-sm text-dim">
        No games in this pool&rsquo;s scope this week.
      </p>
    );
  }

  const heldSides = games
    .flatMap((g) => [
      { game: g, side: g.away },
      { game: g, side: g.home },
    ])
    .filter(({ side }) => picked.has(side.team.id));
  const held = heldSides[0] ?? null;
  const openGames = games.filter((g) => !g.locked);

  const choose = (gameId: number, teamId: number) => {
    setInFlight(teamId);
    start(async () => {
      setError(null);
      if (picked.has(teamId)) {
        const next = new Set(picked);
        next.delete(teamId);
        setPicked(next);
        setConfirmed(false);
        // Extreme names the team — a multi-pick week has several to choose
        // from; classic keeps the old call shape.
        const res = await removeSurvivorPick(
          groupId,
          week,
          seasonType,
          extreme ? teamId : null,
          forUser,
        );
        if (!res.ok) {
          setPicked(new Set([...next, teamId]));
          setConfirmed(true);
          setError(res.message ?? "Could not clear that pick");
        }
        return;
      }
      const before = picked;
      setPicked(extreme ? new Set([...picked, teamId]) : new Set([teamId]));
      setConfirmed(false);
      const res = await makeSurvivorPick(groupId, gameId, teamId, forUser);
      if (!res.ok) {
        setPicked(before);
        setConfirmed(before.size > 0);
        setError(res.message ?? "Could not save that pick");
        return;
      }
      setConfirmed(true);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="status" aria-live="polite" className="card px-3 py-2 text-sm text-loss">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {games.map((g) => {
          const mine = [g.away, g.home].find((s) => picked.has(s.team.id)) ?? null;
          return (
            <li
              key={g.gameId}
              className={`card px-3 py-2.5 ${mine ? "ring-1 ring-inset ring-accent/40" : ""}`}
            >
              <p className="stat mb-1.5 text-[10.5px] uppercase tracking-wider text-chalk/45">
                {g.kick}
              </p>
              <div className="flex gap-2">
                {[g.away, g.home].map((side) => (
                  <TeamButton
                    key={side.team.id}
                    option={side}
                    chosen={picked.has(side.team.id)}
                    locked={g.locked}
                    busy={busy === side.team.id}
                    onChoose={() => choose(g.gameId, side.team.id)}
                  />
                ))}
              </div>
              {/* The receipt, on the card your thumb is already on. */}
              {mine && (
                <p className="stat mt-2 flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-accent">
                  <Check size={12} strokeWidth={3} aria-hidden className="shrink-0" />
                  {g.locked
                    ? `${mine.team.school} is locked in for this week`
                    : busy === mine.team.id || (!extreme && busy !== null)
                      ? `Saving ${mine.team.school}…`
                      : `${mine.team.school} is ${forName ? `${forName}’s` : "your"} pick${confirmed ? " · saved" : ""}`}
                  {!g.locked && busy === null && (
                    <span className="text-chalk/45 normal-case tracking-normal">
                      tap again to clear
                    </span>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {/* What you have in, and the way out. Fixed in the thumb zone above the
          nav (docs/DESIGN.md), always there rather than appearing on the first
          pick — a control that materialises is a control nobody finds. Same
          bar, same offsets as the pick'em board. */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-chalk/10 px-4 pt-2.5 backdrop-blur-xl pb-[calc(0.625rem+var(--bottom-nav-h)+env(safe-area-inset-bottom))] md:pb-[max(0.625rem,env(safe-area-inset-bottom))]"
        style={{
          background: "var(--glass-bar)",
          boxShadow: "inset 0 1px 0 var(--glass-edge)",
        }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {extreme ? (
            heldSides.length > 0 && (
              <span className="flex shrink-0 items-center -space-x-1.5">
                {heldSides.slice(0, 4).map(({ side }) => (
                  <TeamMark key={side.team.id} team={side.team} size={24} />
                ))}
              </span>
            )
          ) : (
            held && <TeamMark team={held.side.team} size={26} />
          )}
          <p role="status" aria-live="polite" className="stat min-w-0 flex-1 text-xs leading-tight">
            <span className="block truncate text-base font-semibold text-chalk">
              {extreme
                ? busy !== null
                  ? "Saving…"
                  : heldSides.length === 0
                    ? "No picks in yet"
                    : `${heldSides.length} ${heldSides.length === 1 ? "team" : "teams"} in`
                : held
                  ? busy !== null
                    ? `Saving ${held.side.team.school}…`
                    : held.side.team.school
                  : "No pick in yet"}
            </span>
            {/* Short by design: this column is a crest and a button wide on a
                phone, and a sub-line that truncates is a sub-line nobody reads.
                "Tap again to clear" lives on the card, where the tap is. */}
            <span className="block truncate text-[10.5px] text-chalk/45">
              {forName ? `for ${forName} · ` : ""}
              {extreme
                ? openGames.length > 0
                  ? `pick as many as you dare · ${openGames.length} of ${games.length} games open`
                  : "Every game has kicked off"
                : held
                  ? held.game.locked
                    ? `Locked in · ${held.game.kick}`
                    : busy !== null
                      ? "Sending it to the pool"
                      : `${confirmed ? "Saved" : "In"} · ${held.game.kick}`
                  : openGames.length > 0
                    ? `${openGames.length} of ${games.length} games open`
                    : "Every game has kicked off"}
            </span>
          </p>
          {reviewHref && (
            <a
              href={reviewHref}
              className="stat inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-ink"
            >
              {held && <Check size={14} strokeWidth={3} aria-hidden />}
              Review picks
              <ArrowRight size={14} aria-hidden />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const BLOCK_WORD: Record<Exclude<PickBlock, null>, string> = {
  used: "already used",
  kicked: "kicked off",
  scope: "out of pool",
};

function TeamButton({
  option,
  chosen,
  locked,
  busy,
  onChoose,
}: {
  option: PickableTeam;
  chosen: boolean;
  /** This game has kicked off — a held pick on it can no longer be cleared. */
  locked: boolean;
  /** This button's own write is out — a hairline cue, not a disabled state. */
  busy: boolean;
  onChoose: () => void;
}) {
  // Your own pick still shows its caption, but "locked in" is the true word for
  // it: `remove_survivor_pick` refuses once the held game has kicked off, so a
  // tap that says "kicked off" would only produce an error.
  const caption = chosen
    ? locked
      ? "locked in"
      : null
    : option.block === "used" && option.spentIn !== null
      ? `used ${option.spentIn}`
      : option.block !== null
        ? BLOCK_WORD[option.block]
        : null;
  const disabled = chosen ? locked : option.block !== null;
  // A team you have spent is gone for the season, which is a different kind of
  // refusal from "this one kicked off" — that one comes back next week. The
  // rule strikes it out so the board reads as the ledger it is at a glance,
  // without the caption having to be read first.
  const spent = option.block === "used";
  return (
    <button
      onClick={onChoose}
      disabled={disabled}
      aria-pressed={chosen}
      aria-busy={busy || undefined}
      className={`flex min-h-11 flex-1 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
        chosen
          ? `border-accent bg-accent/15 ${busy ? "opacity-80" : ""}`
          : disabled
            ? "border-chalk/10 opacity-45"
            : busy
              ? "border-accent/40"
              : "border-chalk/15 hover:border-accent/60"
      }`}
    >
      <TeamMark team={option.team} size={22} />
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm ${chosen ? "text-accent" : "text-chalk"} ${
            spent ? "line-through decoration-chalk/50" : ""
          }`}
        >
          {option.team.school}
        </span>
        {caption && (
          <span className="stat block truncate text-[10px] uppercase tracking-wider text-chalk/45">
            {caption}
          </span>
        )}
      </span>
      {chosen ? (
        <Check size={15} aria-hidden className="shrink-0 text-accent" />
      ) : option.block === "kicked" ? (
        <Lock size={13} aria-hidden className="shrink-0 text-chalk/30" />
      ) : option.block !== null ? (
        <X size={13} aria-hidden className="shrink-0 text-chalk/30" />
      ) : null}
    </button>
  );
}

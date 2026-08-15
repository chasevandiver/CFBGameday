"use client";

import { Check, Lock, X } from "lucide-react";
import { useState, useTransition } from "react";
import { makeSurvivorPick, removeSurvivorPick } from "../../app/actions/survivor";
import type { PickBlock } from "../../lib/survivor";
import type { TeamView } from "../../lib/slate";
import { TeamMark } from "../slate/TeamMark";

export interface PickableTeam {
  team: TeamView;
  /** Null when it can be taken; otherwise why not. */
  block: PickBlock;
}

export interface PickableGame {
  gameId: number;
  kick: string;
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
 * Selecting is a single tap with no confirm: the RPC lets you change your mind
 * until the game you are holding kicks off, and the current pick is shown at the
 * top with its own way out.
 */
export function SurvivorPicker({
  groupId,
  week,
  seasonType,
  games,
  currentTeamId,
  eliminated,
}: {
  groupId: string;
  week: number;
  seasonType: string;
  games: PickableGame[];
  currentTeamId: number | null;
  /** Out of the pool: the board is history now, not a control. */
  eliminated: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(currentTeamId);

  if (eliminated) {
    return (
      <p className="card px-4 py-5 text-center text-sm text-dim">
        You&rsquo;re out of this pool — the board below is everyone else&rsquo;s.
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

  const choose = (gameId: number, teamId: number) =>
    start(async () => {
      setError(null);
      if (picked === teamId) {
        setPicked(null);
        const res = await removeSurvivorPick(groupId, week, seasonType);
        if (!res.ok) {
          setPicked(teamId);
          setError(res.message ?? "Could not clear that pick");
        }
        return;
      }
      const before = picked;
      setPicked(teamId);
      const res = await makeSurvivorPick(groupId, gameId, teamId);
      if (!res.ok) {
        setPicked(before);
        setError(res.message ?? "Could not save that pick");
      }
    });

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="status" aria-live="polite" className="card px-3 py-2 text-sm text-loss">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {games.map((g) => (
          <li key={g.gameId} className="card px-3 py-2.5">
            <p className="stat mb-1.5 text-[10.5px] uppercase tracking-wider text-chalk/45">
              {g.kick}
            </p>
            <div className="flex gap-2">
              {[g.away, g.home].map((side) => (
                <TeamButton
                  key={side.team.id}
                  option={side}
                  chosen={picked === side.team.id}
                  pending={pending}
                  onChoose={() => choose(g.gameId, side.team.id)}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
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
  pending,
  onChoose,
}: {
  option: PickableTeam;
  chosen: boolean;
  pending: boolean;
  onChoose: () => void;
}) {
  const blocked = option.block !== null && !chosen;
  return (
    <button
      onClick={onChoose}
      disabled={blocked || pending}
      aria-pressed={chosen}
      className={`flex min-h-11 flex-1 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
        chosen
          ? "border-accent bg-accent/15"
          : blocked
            ? "border-chalk/10 opacity-45"
            : "border-chalk/15 hover:border-accent/60"
      }`}
    >
      <TeamMark team={option.team} size={22} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${chosen ? "text-accent" : "text-chalk"}`}>
          {option.team.school}
        </span>
        {option.block !== null && (
          <span className="stat block text-[10px] uppercase tracking-wider text-chalk/45">
            {BLOCK_WORD[option.block]}
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

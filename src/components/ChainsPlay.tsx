"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { chainsShareBlock, type ChainsRunState } from "../lib/chains";
import type { DailyStats } from "../lib/daily-stats";
import { TeamMark, type MarkTeam } from "./slate/TeamMark";

interface Side {
  label: string;
  sub: string;
  teamId: number | null;
}
interface FaceUp {
  idx: number;
  kind: string;
  prompt: string;
  left: Side;
  right: Side;
}
interface Revealed extends FaceUp {
  leftValue: number;
  rightValue: number;
  answer: "left" | "right";
  yours?: "left" | "right";
  correct?: boolean;
}

interface ChainsState {
  day: string;
  length: number;
  deckSize: number;
  busted: boolean;
  done: boolean;
  current: FaceUp | null;
  played: Revealed[];
  rest: Revealed[];
  stats: DailyStats;
}

/**
 * Chains' player (CHAIN-2).
 *
 * One card at a time, and the component genuinely has no more than that — the
 * route ships one, so there is nothing here to leak. The chain of results down
 * the left is the whole read: you can see how far you got without reading a
 * number.
 */
export function ChainsPlay({
  crests,
}: {
  crests: Record<number, { school: string; abbr: string; color: string | null; logo: string | null }>;
}) {
  const [state, setState] = useState<ChainsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/chains")
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (!live) return;
        if (ok) setState(body as ChainsState);
        else setError((body as { error?: string }).error ?? "Could not load today's run");
      })
      .catch(() => live && setError("Could not load today's run"));
    return () => {
      live = false;
    };
  }, []);

  const call = (choice: "left" | "right") => {
    if (!state?.current || pending) return;
    const idx = state.current.idx;
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/chains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idx, choice }),
      });
      const body = await res.json();
      if (res.ok) setState(body as ChainsState);
      else setError((body as { error?: string }).error ?? "That did not go through");
    });
  };

  if (error && !state) {
    return (
      <div className="card px-6 py-12 text-center">
        <p className="display text-lg text-chalk/80">{error}</p>
      </div>
    );
  }
  if (!state) return <div className="skeleton h-64 w-full rounded-xl" aria-hidden />;

  const team = (id: number | null): MarkTeam | null => {
    if (id === null) return null;
    const c = crests[id];
    return c ? { school: c.school, abbr: c.abbr, color: c.color, logo: c.logo } : null;
  };

  const runState: ChainsRunState = {
    length: state.length,
    busted: state.busted,
    answers: state.played.map((p) => ({
      idx: p.idx,
      choice: p.yours ?? "left",
      correct: p.correct ?? false,
    })),
    ended_at: state.done ? "done" : null,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* The run itself, as the hero. `.scorebug` is tabular, so 9 → 10 does
          not shift the label under it. */}
      <section className="card px-4 py-5 text-center" aria-label="Your run">
        <p className="stat mb-2 text-[10px] font-semibold uppercase tracking-widest text-chalk/45">
          {state.busted ? "Stopped at" : "Chain"}
        </p>
        <p className="scorebug text-7xl leading-none text-chalk">{state.length}</p>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-1" aria-hidden>
          {state.played.map((p) => (
            <span
              key={p.idx}
              className={`h-2 w-4 rounded-sm ${p.correct ? "bg-accent" : "bg-loss"}`}
            />
          ))}
        </p>
      </section>

      {state.current && (
        <section className="card gtg-unlock px-4 py-4" aria-live="polite">
          <p className="mb-3 text-center text-sm text-chalk">{state.current.prompt}</p>
          <div className="flex items-stretch gap-2">
            <CardSide side={state.current.left} team={team(state.current.left.teamId)} onPick={() => call("left")} disabled={pending} />
            <CardSide side={state.current.right} team={team(state.current.right.teamId)} onPick={() => call("right")} disabled={pending} />
          </div>
        </section>
      )}

      {error && <p className="text-xs text-loss">{error}</p>}

      {state.done && (
        <section className="card gtg-slide-up px-4 py-5 text-center">
          <p className="display text-lg text-chalk">
            {state.busted ? `${state.length} in a row` : "Cleared the deck"}
          </p>
          <div className="mt-3 flex items-center justify-center gap-4 text-xs text-dim">
            <span className="stat">Best {state.stats.best ?? 0}</span>
            <span className="stat">Played {state.stats.played}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(chainsShareBlock(state.day, runState, state.stats.best ?? 0))
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
            }}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-elev px-4 text-sm font-semibold text-chalk ring-1 ring-inset ring-chalk/12 hover:ring-accent/40"
          >
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? "Copied" : "Share"}
          </button>
        </section>
      )}

      {/* Everything already settled, newest first — the cards you called and,
          once the run is over, the ones you never reached. */}
      {(state.played.length > 0 || state.rest.length > 0) && (
        <ol className="flex flex-col gap-2">
          {[...state.played].reverse().map((p) => (
            <Settled key={`p${p.idx}`} card={p} />
          ))}
          {state.rest.map((p) => (
            <Settled key={`r${p.idx}`} card={p} unreached />
          ))}
        </ol>
      )}
    </div>
  );
}

function CardSide({
  side,
  team,
  onPick,
  disabled,
}: {
  side: Side;
  team: MarkTeam | null;
  onPick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="flex min-h-11 flex-1 flex-col items-center gap-1.5 rounded-lg bg-elev px-2 py-3 text-center ring-1 ring-inset ring-chalk/12 transition-colors hover:ring-accent/40 disabled:opacity-60"
    >
      {team && <TeamMark team={team} size={28} />}
      <span className="text-sm font-semibold text-chalk">{side.label}</span>
      <span className="stat text-[11px] text-dim">{side.sub}</span>
    </button>
  );
}

function Settled({ card, unreached = false }: { card: Revealed; unreached?: boolean }) {
  const win = card.answer === "left" ? card.left : card.right;
  return (
    <li className={`card px-3 py-2.5 ${unreached ? "opacity-60" : ""}`}>
      <p className="text-xs text-dim">{card.prompt}</p>
      <p className="mt-1 flex items-baseline justify-between gap-3 text-sm">
        <span
          className={
            unreached ? "text-chalk" : card.correct ? "text-win" : "text-loss"
          }
        >
          {win.label}
        </span>
        <span className="stat text-xs text-dim">
          {card.leftValue} · {card.rightValue}
        </span>
      </p>
    </li>
  );
}

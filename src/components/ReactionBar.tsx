"use client";

import { useState, useTransition } from "react";
import { toggleReaction } from "../app/actions/reactions";

/**
 * One-tap reactions (R2-D4). Optimistic: the tap paints, the write follows,
 * a failure reverts silently (a reaction is not worth an error banner).
 * Four emoji, no free text — the conversation stays in the group chat; the
 * receipts get to feel it.
 */

const EMOJI: Array<{ key: string; glyph: string; label: string }> = [
  { key: "fire", glyph: "🔥", label: "Fire" },
  { key: "skull", glyph: "💀", label: "Skull" },
  { key: "ice", glyph: "🧊", label: "Ice" },
  { key: "dart", glyph: "🎯", label: "Dart" },
];

export function ReactionBar({
  subject,
  subjectId,
  counts,
  mine,
  signedIn,
}: {
  subject: "pick" | "bet";
  subjectId: number;
  /** emoji key → count, from the server render. */
  counts: Record<string, number>;
  /** emoji keys the viewer has already given. */
  mine: string[];
  signedIn: boolean;
}) {
  const [state, setState] = useState(() => ({
    counts: { ...counts },
    mine: new Set(mine),
  }));
  const [, startTransition] = useTransition();

  const tap = (key: string) => {
    if (!signedIn) return;
    setState((prev) => {
      const had = prev.mine.has(key);
      const nextMine = new Set(prev.mine);
      if (had) nextMine.delete(key);
      else nextMine.add(key);
      return {
        counts: { ...prev.counts, [key]: Math.max(0, (prev.counts[key] ?? 0) + (had ? -1 : 1)) },
        mine: nextMine,
      };
    });
    startTransition(async () => {
      const res = await toggleReaction(subject, subjectId, key);
      if (!res.ok) {
        // Revert quietly — re-derive from the tap we just made.
        setState((prev) => {
          const had = prev.mine.has(key);
          const nextMine = new Set(prev.mine);
          if (had) nextMine.delete(key);
          else nextMine.add(key);
          return {
            counts: {
              ...prev.counts,
              [key]: Math.max(0, (prev.counts[key] ?? 0) + (had ? -1 : 1)),
            },
            mine: nextMine,
          };
        });
      }
    });
  };

  const visible = EMOJI.filter((e) => signedIn || (state.counts[e.key] ?? 0) > 0);
  if (visible.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label="Reactions">
      {visible.map((e) => {
        const n = state.counts[e.key] ?? 0;
        if (!signedIn && n === 0) return null;
        return (
          <button
            key={e.key}
            type="button"
            onClick={() => tap(e.key)}
            disabled={!signedIn}
            aria-pressed={state.mine.has(e.key)}
            aria-label={`${e.label}${n > 0 ? `, ${n}` : ""}`}
            className={`inline-flex min-h-6 items-center gap-0.5 rounded-full px-1.5 text-[11px] leading-none transition-colors ${
              state.mine.has(e.key)
                ? "bg-accent/15 ring-1 ring-inset ring-accent/40"
                : n > 0
                  ? "bg-elev ring-1 ring-inset ring-chalk/10"
                  : "opacity-40 hover:opacity-80"
            } ${signedIn ? "" : "cursor-default"}`}
          >
            <span aria-hidden>{e.glyph}</span>
            {n > 0 && <span className="stat text-chalk/70">{n}</span>}
          </button>
        );
      })}
    </span>
  );
}

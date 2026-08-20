"use client";

import { Sparkles } from "lucide-react";
import { useFunPrefs, type FunPiece } from "../lib/fun-mode";

/**
 * Fun Mode (FUN-1) — the gameday pageantry layer, one switch and per-piece
 * opt-outs. Everything here is presentation on this device only: no push, no
 * data, nothing anyone else can see (crowd signs are written elsewhere; the
 * toggle here only decides whether YOU see the wall).
 */

const RITUALS: { piece: FunPiece; label: string; hint: string }[] = [
  { piece: "cover", label: "The Cover & Sign-Off", hint: "A program cover opens a gameday; a sign-off closes it" },
  { piece: "panel", label: "The Panel", hint: "Crew picks for the big game reveal one by one" },
  { piece: "signs", label: "Crowd signs", hint: "The crew's posterboard wall above the Saturday slate" },
  { piece: "rundown", label: "The Rundown", hint: "The Saturday slate loads in like a broadcast rundown" },
];

const MOTION: { piece: FunPiece; label: string; hint: string }[] = [
  { piece: "pulse", label: "The pulse", hint: "Live cards breathe with the game — quicker in the red zone" },
  { piece: "ripples", label: "News ripples", hint: "Scores ripple across the ticker and the field" },
  { piece: "transitions", label: "Page transitions", hint: "Pages and weeks glide instead of cutting" },
];

const ATMOSPHERE: { piece: FunPiece; label: string; hint: string }[] = [
  { piece: "fallLight", label: "Fall light", hint: "The backdrop follows the day — noon glare to under the lights" },
  { piece: "weatherFx", label: "Weather on the glass", hint: "Rain, snow, and wind rendered on cold-game cards" },
  { piece: "broadcast", label: "Broadcast package", hint: "Live cards get a production-truck score bug" },
  { piece: "rivalry", label: "Rivalry takeover", hint: "Trophy games split the card in both team colors" },
  { piece: "pennants", label: "Pennants", hint: "Your teams hang as felt pennants over the slate" },
  { piece: "stubs", label: "Ticket stubs", hint: "Every graded week mints a stub on this page" },
];

function ToggleList({
  title,
  items,
  prefs,
  disabled,
  onToggle,
}: {
  title: string;
  items: { piece: FunPiece; label: string; hint: string }[];
  prefs: Record<FunPiece, boolean>;
  disabled: boolean;
  onToggle: (piece: FunPiece, on: boolean) => void;
}) {
  return (
    <div className="mt-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-dim">{title}</h3>
      <ul className="mt-2 space-y-2">
        {items.map(({ piece, label, hint }) => (
          <li key={piece} className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-xs">
              <span className={disabled ? "text-dim" : "text-chalk"}>{label}</span>
              <span className="block text-dim">{hint}</span>
            </span>
            <input
              type="checkbox"
              checked={prefs[piece]}
              disabled={disabled}
              onChange={(e) => onToggle(piece, e.target.checked)}
              aria-label={label}
              className="size-5 shrink-0 accent-[var(--accent)] disabled:opacity-40"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FunModeSettings() {
  const [prefs, update] = useFunPrefs();

  return (
    <section className="card mt-6 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm text-accent">
        <Sparkles size={14} aria-hidden />
        Fun Mode
      </h2>
      <p className="text-xs text-dim">
        The pageantry layer — gameday rituals and atmosphere, on this device. Everything below is
        how the site looks and moves for you; scores, lines, and picks are untouched.
      </p>

      <div className="mt-3 flex min-h-11 items-center justify-between gap-3">
        <span className="text-xs">
          <span className="font-semibold text-chalk">
            {prefs.master ? "On for this device" : "Off"}
          </span>
          <span className="block text-dim">One switch; fine-tune the pieces below.</span>
        </span>
        <button
          onClick={() => update({ master: !prefs.master })}
          aria-pressed={prefs.master}
          className={
            prefs.master
              ? "min-h-11 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
              : "min-h-11 rounded-lg border border-chalk/15 px-3 text-sm font-medium text-chalk transition-colors hover:border-chalk/30"
          }
        >
          {prefs.master ? "Turn off" : "Turn on"}
        </button>
      </div>

      <ToggleList
        title="Gameday rituals"
        items={RITUALS}
        prefs={prefs}
        disabled={!prefs.master}
        onToggle={(piece, on) => update({ [piece]: on })}
      />
      <ToggleList
        title="Atmosphere"
        items={ATMOSPHERE}
        prefs={prefs}
        disabled={!prefs.master}
        onToggle={(piece, on) => update({ [piece]: on })}
      />
      <ToggleList
        title="Motion"
        items={MOTION}
        prefs={prefs}
        disabled={!prefs.master}
        onToggle={(piece, on) => update({ [piece]: on })}
      />
    </section>
  );
}

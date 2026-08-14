"use client";

import { CONFIDENCE_TIERS, CONFIDENCE_TIER_LABELS, type ConfidenceTier } from "../lib/db-types";

/**
 * How strongly you like a bet, on the ladder the share card sorts by.
 *
 * A `<select>` rather than a row of chips, and deliberately: six options with
 * labels as long as "Bet of the Century" cannot fit a dense slip row at 44px
 * each, and the native picker is the one control on a phone that is already
 * thumb-sized, already scrollable and already accessible. It sits beside the
 * reason-tag select on the slip for the same reason that one is a select.
 *
 * BRAND.md §16 lists "confidence" among the preferred vocabulary, which is why
 * this is not called a lock, a hammer or a play.
 */
export function ConfidencePicker({
  value,
  onChange,
  id,
  label = "Confidence",
  className,
}: {
  value: ConfidenceTier;
  onChange: (tier: ConfidenceTier) => void;
  id?: string;
  label?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as ConfidenceTier)}
      className={
        className ??
        // bg-elev rather than transparent: a native select popup inherits the
        // control's background on Windows dark mode, and transparent renders it
        // unreadable.
        "stat min-h-11 rounded-lg border border-chalk/20 bg-elev px-2 text-xs text-chalk focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      }
    >
      {/* Highest conviction first: the ladder is stored low-to-high because the
          card sorts on the index, but a picker that opens on "Lean" reads as if
          that were the default. */}
      {[...CONFIDENCE_TIERS].reverse().map((t) => (
        <option key={t} value={t}>
          {CONFIDENCE_TIER_LABELS[t]}
        </option>
      ))}
    </select>
  );
}

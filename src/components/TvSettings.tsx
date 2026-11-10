"use client";

import { Check, Copy, Tv } from "lucide-react";
import { useState } from "react";

/**
 * Your TV links (TV-2): the /tv overlay pages with your calendar key on them,
 * so the Fire TV overlay can show which games you're on without signing in.
 * Same key as the calendar card, so that card's Rotate resets these too.
 */
const LINKS = [
  { label: "Ticker strip", path: "/tv/ticker" },
  { label: "Corner scoreboard", path: "/tv/corner" },
] as const;

export function TvSettings({ token }: { token: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (path: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}?k=${token}`);
      setCopied(path);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard can be denied; the visible path below is the fallback.
    }
  };

  return (
    <section className="card mt-4 p-4">
      <div className="mb-1 flex items-center gap-2">
        <Tv className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="text-sm text-accent">On your TV</h2>
      </div>
      <p className="mb-3 text-xs text-dim">
        Your own links for the TV Overlay app. Games you have a bet or pick on light up green when
        you&rsquo;re covering and red when you&rsquo;re not. Paste one into the overlay&rsquo;s
        &ldquo;Any page&rdquo; box and save it. Rotating your calendar link resets these too.
      </p>
      <ul className="space-y-2">
        {LINKS.map(({ label, path }) => (
          <li
            key={path}
            className="flex items-center justify-between gap-3 rounded-lg bg-elev px-3 py-2 ring-1 ring-inset ring-chalk/8"
          >
            <span className="min-w-0">
              <span className="block text-sm text-chalk">{label}</span>
              <span className="stat block truncate text-[11px] text-chalk/60">
                {path}?k={token.slice(0, 8)}…
              </span>
            </span>
            <button
              type="button"
              onClick={() => void copy(path)}
              className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-ink"
            >
              {copied === path ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              {copied === path ? "Copied" : "Copy"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

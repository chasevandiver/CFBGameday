"use client";

import { Image as ImageIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { shareImage } from "../lib/share-image";

/**
 * The second share: a rendered card instead of plain text.
 *
 * Generation takes a beat — a network round trip and a satori render — so the
 * button has to say so. It keeps a fixed width while it does: DESIGN.md
 * forbids layout shift, and a button that resizes under a thumb mid-press
 * moves the 44px target it was hit with. `min-w` rather than a spinner-only
 * state for the same reason.
 */
export function ShareImageButton({
  payload,
  filename,
  label = "Share image",
  className,
}: {
  /** Built by the caller — see `share-card-build.ts`. Null disables. */
  payload: unknown | null;
  filename: string;
  label?: string;
  className?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const go = () => {
    if (!payload) return;
    startTransition(async () => {
      const outcome = await shareImage(payload, filename);
      if (outcome === "shared" || outcome === "dismissed") return;
      setNote(outcome === "downloaded" ? "Saved" : "Could not share");
      setTimeout(() => setNote(null), 1800);
    });
  };

  return (
    <button
      onClick={go}
      disabled={pending || !payload}
      aria-busy={pending}
      className={
        className ??
        "stat flex min-h-11 min-w-[8.5rem] items-center justify-center gap-1.5 rounded-lg border border-chalk/20 px-3 text-xs font-semibold text-chalk hover:border-chalk/50 disabled:opacity-60"
      }
    >
      <ImageIcon size={14} aria-hidden />
      {pending ? "Drawing…" : (note ?? label)}
    </button>
  );
}

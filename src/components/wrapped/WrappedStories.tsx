"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { WrappedCardFact } from "../../lib/wrapped";
import { ShareImageButton } from "../ShareImageButton";

/**
 * The Slate Wrapped (R5-C): full-viewport story cards on native scroll-snap
 * — no hijacking, no timers, the thumb owns the pace. One fact per screen,
 * stated huge in the brand's own board typography; each card shares as a
 * 1080×1350 image through the same pipeline as the bet slip.
 */

function StoryCard({
  card,
  year,
  index,
  shareable,
}: {
  card: WrappedCardFact;
  year: number;
  index: number;
  shareable: boolean;
}) {
  const payload = {
    kind: "wrapped" as const,
    year,
    eyebrow: card.eyebrow,
    headline: card.headline,
    detail: card.detail ?? null,
    sub: card.sub ?? null,
  };
  return (
    <section
      className="flex min-h-dvh snap-start flex-col justify-center px-7 py-14"
      aria-label={card.eyebrow}
    >
      <p className="stat text-[11px] uppercase tracking-[0.24em] text-accent">{card.eyebrow}</p>
      <p
        className={`scorebug mt-4 break-words leading-[1.05] text-chalk ${
          card.headline.length <= 6 ? "text-7xl sm:text-8xl" : card.headline.length <= 12 ? "text-5xl sm:text-6xl" : "text-4xl sm:text-5xl"
        }`}
      >
        {card.headline}
      </p>
      {card.detail && <p className="mt-5 max-w-md text-base leading-relaxed text-chalk/85">{card.detail}</p>}
      {card.sub && <p className="stat mt-2 text-sm text-dim">{card.sub}</p>}
      {shareable && (
        <div className="mt-7">
          <ShareImageButton payload={payload} filename={`slate-wrapped-${year}-${index + 1}.png`} />
        </div>
      )}
    </section>
  );
}

export function WrappedStories({
  year,
  cards,
  preview = false,
}: {
  year: number;
  cards: WrappedCardFact[];
  preview?: boolean;
}) {
  return (
    <div
      className="brand-surface bg-background h-dvh snap-y snap-mandatory overflow-y-auto"
      style={{
        paddingLeft: "max(env(safe-area-inset-left), 0px)",
        paddingRight: "max(env(safe-area-inset-right), 0px)",
      }}
    >
      {/* the cover */}
      <section className="flex min-h-dvh snap-start flex-col justify-center px-7 py-14 text-center">
        <p className="stat text-[11px] uppercase tracking-[0.24em] text-dim">
          {preview ? "Preview · posed data" : "The receipts remember"}
        </p>
        <h1 className="mt-4 text-5xl leading-none text-chalk sm:text-6xl">The Slate</h1>
        <p className="mt-1 text-3xl text-accent sm:text-4xl" style={{ fontFamily: "var(--font-display-brand)" }}>
          Wrapped
        </p>
        <p className="stat mt-6 text-sm text-dim">Season {year} · swipe up</p>
      </section>

      {cards.map((c, i) => (
        <StoryCard key={c.kind} card={c} year={year} index={i} shareable={!preview} />
      ))}

      {/* the way out */}
      <section className="flex min-h-dvh snap-start flex-col items-center justify-center gap-6 px-7">
        <p className="stat text-sm text-dim">That was the season.</p>
        <Link
          href="/"
          className="flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
        >
          <ArrowLeft size={14} aria-hidden /> Back to The Slate
        </Link>
      </section>
    </div>
  );
}

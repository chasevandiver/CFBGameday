import Link from "next/link";

/**
 * The strip that sits above the demo screens.
 *
 * Two jobs, and the second is the one that is easy to miss. It says the numbers
 * are invented — a demo that shows a fake leaderboard with no marker on it is a
 * demo somebody screenshots and someone else believes. And it carries the only
 * link between the two demo screens: the app's own nav points at the real `/`
 * and `/slate`, which for a signed-out visitor is a week header and a sign-in
 * card, so following it out of the demo is a dead end.
 *
 * Deliberately quiet. It is the one thing on these pages that isn't the
 * product, and it sits above the hero rather than across it so a screenshot can
 * be cropped to the real screen.
 */
export function DemoBar({ here }: { here: "hub" | "slate" }) {
  return (
    <div className="mb-3">
      {/* One row on a phone: the marker reads left, the way out reads right.
          Stacking these was costing a third of the first screen, which on the
          one page meant to be screenshotted is the wrong third to spend. */}
      <div className="flex items-center gap-2">
        <span className="stat inline-flex shrink-0 items-center gap-1.5 rounded-full border border-chalk/15 px-2.5 py-1 text-[10.5px] uppercase tracking-wider text-dim">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          Sample data
        </span>
        <nav aria-label="Demo screens" className="ml-auto flex shrink-0 items-center gap-1.5">
          <DemoTab href="/demo" label="Hub" active={here === "hub"} />
          <DemoTab href="/demo/slate" label="Slate" active={here === "slate"} />
        </nav>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-dim">
        Every number below is invented — no real games, no real money.
      </p>
    </div>
  );
}

function DemoTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`stat inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold ${
        active
          ? "border border-accent/50 text-accent"
          : "border border-chalk/15 text-dim hover:border-chalk/40 hover:text-chalk"
      }`}
    >
      {label}
    </Link>
  );
}

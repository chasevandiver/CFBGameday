import Link from "next/link";
import type { ReactNode } from "react";
import { SlateMark } from "../SlateMark";

/**
 * The pieces `/welcome` is built from.
 *
 * Split out of the page so the page file is copy rather than markup, and so the
 * link test can render the content without pulling in a route.
 *
 * Everything here draws on tokens the app already defines — the page wraps
 * itself in `.brand-surface` (globals.css), which pins the Field palette
 * regardless of the visitor's theme, so `text-accent` here is goalpost gold and
 * `bg-background` is near-black without a single hex appearing in this file.
 */

/** Where an invite request goes. One place, because it is printed twice. */
export const INVITE_EMAIL = "chasevandiver@gmail.com";

export const INVITE_MAILTO =
  `mailto:${INVITE_EMAIL}` +
  "?subject=" +
  encodeURIComponent("The Slate — invite request") +
  "&body=" +
  encodeURIComponent(
    "Who I am:\n\nWho I know in the group:\n\nThe email I'd sign in with:\n",
  );

/**
 * The kicker above a section title. Mono and letterspaced, the way the rest of
 * the product sets a label — see the ledger's stat tiles.
 */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="stat text-[11px] uppercase tracking-[0.3em] text-accent">{children}</p>
  );
}

/**
 * A numbered section head, set like a page in a printed gameday program: the
 * number in mono on a hairline rule, the title in the display face beneath it.
 *
 * The number is decorative — it is `aria-hidden` and the heading carries the
 * whole accessible name, so a screen reader hears "The board", not "03 the
 * board".
 */
export function SectionHead({
  n,
  eyebrow,
  title,
  lede,
  id,
}: {
  n: string;
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  id: string;
}) {
  return (
    <header className="mb-7">
      <div className="flex items-center gap-3 border-b border-chalk/15 pb-2">
        <span aria-hidden className="stat text-[11px] tracking-[0.2em] text-accent">
          {n}
        </span>
        <span className="stat text-[11px] uppercase tracking-[0.3em] text-dim">{eyebrow}</span>
      </div>
      <h2 id={id} className="mt-4 scroll-mt-20 text-balance text-2xl sm:text-3xl">
        {title}
      </h2>
      {lede && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-dim">{lede}</p>}
    </header>
  );
}

/** A section, with its heading wired to the region for assistive tech. */
export function Section({
  id,
  children,
  className = "",
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={`mx-auto w-full max-w-5xl px-5 ${className}`}>
      {children}
    </section>
  );
}

/**
 * One screen of the product, as a card.
 *
 * `.card` is the app's own glass, so the pitch is made out of the same material
 * as the thing being pitched — a prospect scrolling from here into `/demo`
 * should not cross a seam.
 */
export function FeatureCard({
  label,
  title,
  children,
  href,
  linkLabel,
}: {
  label: string;
  title: string;
  children: ReactNode;
  /** Omitted when the screen needs an account to show anything. */
  href?: string;
  linkLabel?: string;
}) {
  return (
    <article className="card flex flex-col p-5">
      <p className="stat text-[10.5px] uppercase tracking-[0.2em] text-accent">{label}</p>
      <h3 className="mt-2 text-base font-semibold text-chalk">{title}</h3>
      <div className="mt-2 flex-1 text-sm leading-relaxed text-dim">{children}</div>
      {href && (
        <Link
          href={href}
          className="stat mt-4 inline-flex min-h-11 items-center text-xs font-semibold text-accent hover:underline"
        >
          {linkLabel ?? "Take a look"} →
        </Link>
      )}
    </article>
  );
}

/**
 * A day in the week, in the walkthrough rail.
 *
 * The rule down the left is the field-inspired divider from BRAND §31, and it
 * is what makes five stacked blocks read as one sequence on a phone.
 */
export function Step({
  when,
  title,
  children,
}: {
  when: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="relative border-l border-chalk/15 pb-7 pl-5 last:pb-0">
      <span
        aria-hidden
        className="absolute -left-[3.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-accent"
      />
      <p className="stat text-[11px] uppercase tracking-[0.22em] text-accent">{when}</p>
      <h3 className="mt-1.5 text-base font-semibold text-chalk">{title}</h3>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-dim">{children}</p>
    </li>
  );
}

/**
 * A number and what it counts.
 *
 * Numbers are a major part of this brand (§12) and these are the only figures
 * on the page a visitor can check for themselves, so they are set at the size
 * the scoreboard would use.
 */
export function StatTile({ figure, label }: { figure: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 border-l border-chalk/15 pl-3.5">
      <span className="stat text-xl font-semibold tabular-nums text-chalk sm:text-2xl">
        {figure}
      </span>
      <span className="text-[11.5px] leading-snug text-dim">{label}</span>
    </div>
  );
}

/** The primary action. Gold fill — §5 puts key CTAs on the accent. */
export function PrimaryCta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="stat inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-accent-ink sm:w-auto"
    >
      {children}
    </Link>
  );
}

/** The secondary action. An `<a>`, not a `Link` — the invite ask is a mailto. */
export function SecondaryCta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="stat inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-chalk/25 px-5 text-sm font-semibold text-chalk hover:border-chalk/50 sm:w-auto"
    >
      {children}
    </a>
  );
}

/**
 * The marketing page's own chrome.
 *
 * Deliberately not `AppNav`. That header carries nine product tabs, a live
 * score ticker and a theme toggle — furniture for someone who already has an
 * account, and on a phone its bottom bar would sit exactly where this page
 * wants its call to action. A visitor who has not signed in needs one way in
 * and one way back to the mark.
 */
export function WelcomeHeader() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-accent-ink"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-chalk/10 backdrop-blur-xl backdrop-saturate-150"
        style={{ background: "var(--glass-bar)", boxShadow: "inset 0 -1px 0 var(--glass-edge)" }}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-5">
          <Link href="/welcome" aria-label="The Slate" className="flex items-center gap-2 leading-none">
            <SlateMark size={22} className="text-chalk" />
            <span className="display text-lg text-accent">The Slate</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/demo"
              className="stat hidden min-h-11 items-center rounded-lg border border-chalk/20 px-3 text-xs font-semibold text-chalk hover:border-chalk/50 sm:inline-flex"
            >
              Live demo
            </Link>
            <Link
              href="/login"
              className="stat inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold text-accent hover:underline"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}

export function WelcomeFooter() {
  return (
    <footer
      className="mt-20 border-t border-chalk/12 pt-10"
      style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5">
        <div className="flex items-center gap-2 leading-none">
          <SlateMark size={18} className="text-chalk" />
          <span className="display text-sm text-accent">The Slate</span>
        </div>
        <p className="max-w-xl text-xs leading-relaxed text-dim">
          A private site for one group of friends. Invite-only, no ads, nothing for sale, and no
          money changes hands here — it keeps the books, the group settles up itself.
        </p>
        <nav aria-label="Public pages" className="flex flex-wrap gap-x-4 gap-y-1">
          {[
            ["/demo", "Demo"],
            ["/slate", "This week"],
            ["/rules", "League rules"],
            ["/model", "The model"],
            ["/login", "Sign in"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="stat inline-flex min-h-11 items-center text-xs text-dim hover:text-chalk"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

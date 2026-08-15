"use client";

import Link from "next/link";
import { demoSlateData } from "../../lib/demo-data";
import { GameCard } from "../slate/GameCard";

/**
 * Two real game cards, on the marketing page.
 *
 * ## Why the actual component and not a picture of one
 *
 * A screenshot goes stale the first time the card changes and nobody notices
 * for a season; a hand-built facsimile is a drawing of a product rather than
 * the product, and this page's whole argument is that it is not selling a
 * mock-up. So this imports `GameCard` — the same component the slate renders —
 * and feeds it the same invented Saturday `/demo` runs on. When the card gains
 * a row, this gains it too.
 *
 * ## Why the time is frozen
 *
 * `/demo` anchors its sample Saturday to whenever the page is opened, which is
 * right for a page you walk around in and wrong here: it would make `/welcome`
 * dynamic, and this is the one page on the site that should cost nothing to
 * serve. A fixed instant renders at build time and always poses the same two
 * cards — one game live and covering, one still to kick with the model's
 * disagreement on it.
 *
 * `demo` is passed for the reason it exists: the game ids are invented, so the
 * card must not be a link to a game that never happened.
 */

/** Saturday 14 Nov 2026, mid-afternoon — the same instant the demo tests pose. */
const FROZEN = Date.parse("2026-11-14T18:00:00Z");

export function CardShowcase() {
  const { games } = demoSlateData(FROZEN);
  const live = games.find((g) => g.status === "in_progress");
  const upcoming = games.find((g) => g.status === "scheduled");
  const shown = [live, upcoming].filter((g) => g !== undefined);
  if (shown.length === 0) return null;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="stat inline-flex shrink-0 items-center gap-1.5 rounded-full border border-chalk/15 px-2.5 py-1 text-[10.5px] uppercase tracking-wider text-dim">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          Sample data
        </span>
        <p className="text-[13px] leading-snug text-dim">
          The real cards, on invented games — one live, one still to kick.
        </p>
      </div>

      {/* `inert`, not `aria-hidden`. These cards are illustration — a star that
          does nothing is worse than no star — but they are full of real
          buttons: the star, the odds cells, the tail action. `aria-hidden`
          would take them out of the accessibility tree and leave every one of
          them in the tab order, which is the worst of both. `inert` removes
          both, so a keyboard passes straight over the showcase to the link
          underneath it. The caption above stays outside, and says what this is. */}
      <div inert className="grid gap-4 sm:grid-cols-2">
        {shown.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            tz="America/Chicago"
            starred={[]}
            onStar={() => {}}
            demo
          />
        ))}
      </div>

      <p className="mt-4 text-sm text-dim">
        <Link href="/demo/slate" className="text-accent hover:underline">
          Open the whole slate →
        </Link>{" "}
        twelve games, three of them live, everything working.
      </p>
    </div>
  );
}

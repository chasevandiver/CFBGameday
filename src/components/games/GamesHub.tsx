import Link from "next/link";
import { gamesHubRows, type GamesHubState } from "../../lib/games-hub";
import { GamesScopePicker } from "./GamesScopePicker";

/**
 * The Games hub body (R3-E1). Presentation only — `src/app/games/page.tsx`
 * does the reads, the way `HomeDashboard` splits from `app/page.tsx`, so a
 * demo harness can render this against sample data later without the page's
 * database work.
 *
 * Rows are `min-h-16` full-row links: the 64px target DESIGN.md's 44px rule
 * asks for, and the shape `/groups` already uses for its pool list. The state
 * block is `stat` (tabular figures) so a streak going 9 → 10 shifts nothing.
 */
export function GamesHub({
  state,
  groups,
  activeParam,
  scopeName,
  signedIn,
}: {
  state: GamesHubState;
  groups: Array<{ slug: string; name: string }>;
  activeParam: string;
  scopeName: string;
  signedIn: boolean;
}) {
  const rows = gamesHubRows(state);
  const owed = rows.filter((r) => r.outstanding).length;

  return (
    <>
      <h1 className="mb-1 text-2xl">Games</h1>
      <p className="mb-4 text-sm leading-relaxed text-dim">
        Four games, free to play, scored in points.{" "}
        {signedIn
          ? owed > 0
            ? `${owed} waiting on you today.`
            : "You’re caught up today."
          : "Sign in to play and to see how your crew is doing."}
      </p>

      {signedIn && <GamesScopePicker groups={groups} activeParam={activeParam} />}

      <p className="mb-2.5 text-xs text-dim">
        Competing in <span className="text-chalk">{scopeName}</span> — you play once, and your
        result is ranked in every pool you’re in.
      </p>

      <ul className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={r.href}
              className="card card-hover flex min-h-16 items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="font-sans text-sm text-chalk">{r.name}</span>
                  {r.outstanding && (
                    <>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                      <span className="sr-only">— waiting on you</span>
                    </>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-dim">{r.blurb}</span>
              </span>
              <span className="stat shrink-0 text-right text-xs text-chalk/70">{r.state}</span>
            </Link>
          </li>
        ))}
      </ul>

      {!signedIn && (
        <p className="mt-4 text-sm text-dim">
          <Link href="/login" className="text-accent underline-offset-2 hover:underline">
            Sign in
          </Link>{" "}
          to play.
        </p>
      )}
    </>
  );
}

import type { ArcadeRow } from "../../lib/arcade";
import type { Trophy } from "../../lib/trophies";

/**
 * The Arcade (R3-E3): one standing across all four games, plus the viewer's
 * own trophy shelf.
 *
 * Presentation only — `src/lib/arcade-data.ts` does the reads and
 * `src/lib/arcade.ts` does the arithmetic. Two rules from DESIGN.md are doing
 * visible work here: every number sits in `stat` (tabular figures, so 9 → 10
 * shifts nothing), and the four components are always rendered even at zero,
 * because **the breakdown is how anyone audits the total** — a row that shows
 * only a sum invites the question it cannot answer.
 *
 * The shelf is the viewer's own by necessity, not by preference; the reason
 * is written out in `arcade-data.ts`.
 *
 * `ArcadeBody` is the shared middle so the two surfaces cannot drift: /games
 * wraps it in a card (`ArcadeBoard`), and a group hub wraps it in that page's
 * ruled-heading section idiom (`GroupArcade`).
 */
export function ArcadeBody({
  standings,
  trophies,
  signedIn,
}: {
  standings: ArcadeRow[];
  trophies: Trophy[];
  signedIn: boolean;
}) {
  const anyScored = standings.some((r) => r.n > 0);

  return (
    <>
      {!anyScored ? (
        <p className="text-sm text-dim">
          {signedIn
            ? "Nobody here has scored yet — first play sets the pace."
            : "Sign in to see how your crew is doing."}
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {standings.map((r, i) => (
            <li key={r.userId} className="flex flex-col gap-0.5 py-0.5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="stat truncate text-sm">
                  <span className="text-dim">{i + 1}.</span>{" "}
                  <span className="font-sans text-chalk">{r.name}</span>
                </span>
                <span className="stat shrink-0 text-sm text-chalk">
                  {r.total}
                  <span className="text-dim"> pts</span>
                </span>
              </span>
              <span className="stat text-xs text-dim">
                Streak {r.parts.streak} · Puzzle {r.parts.gtg} · Lines {r.parts.lines} · Six{" "}
                {r.parts.sixPack}
                {r.n > 0 && ` · ${r.perWeek}/wk`}
              </span>
            </li>
          ))}
        </ol>
      )}

      {signedIn && (
        <div className="mt-4 border-t border-chalk/10 pt-3">
          <h3 className="mb-2 text-xs text-dim">Your shelf</h3>
          {trophies.length === 0 ? (
            <p className="text-xs leading-relaxed text-dim">
              Nothing yet. Ten in a row, a line called exactly, a puzzle solved on the first
              guess — any of them starts it.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {trophies.map((t) => (
                <li
                  key={t.id}
                  title={t.blurb}
                  className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-chalk"
                >
                  {t.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/** The /games surface: a card under the game list. */
export function ArcadeBoard({
  standings,
  trophies,
  scopeName,
  signedIn,
}: {
  standings: ArcadeRow[];
  trophies: Trophy[];
  scopeName: string;
  signedIn: boolean;
}) {
  return (
    <section className="card mt-4 p-4" aria-labelledby="arcade-heading">
      <h2 id="arcade-heading" className="mb-1 text-sm text-accent">
        The Arcade — {scopeName}
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-dim">
        Every game, one total. A full week at any of them is worth about the same, so playing the
        one you like is never the wrong move.
      </p>
      <ArcadeBody standings={standings} trophies={trophies} signedIn={signedIn} />
    </section>
  );
}

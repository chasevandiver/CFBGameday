import { parseFinalScore, type GtgHint } from "../../lib/guess-game";

/**
 * The hook: the final score, full width, as the first thing on the screen.
 *
 * It used to be a row in the clue list, which made the whole puzzle read as a
 * form — the most interesting number on the screen set at the same size as
 * its own label. Broadcast graphics put the score at the top and enormous,
 * and this is that: two condensed numerals split left and right off a
 * hairline, everything else on the block subordinate to them.
 *
 * `.scorebug` is the existing broadcast numeral class (condensed display
 * face, tabular figures, 700). Tabular is what keeps 7 → 10 from shifting the
 * divider, which is the one thing a hero number must never do.
 */
export function GtgScoreboard({ hints }: { hints: GtgHint[] }) {
  const score = parseFinalScore(hints);
  if (!score) return null;

  return (
    <section className="card px-4 py-6" aria-label="Final score">
      <p className="stat mb-4 text-center text-[10px] font-semibold uppercase tracking-widest text-chalk/45">
        Final score
      </p>
      <div className="flex items-stretch">
        <Side value={score.home} label="Home" />
        {/* A hairline, not a border on a side: it has to read as the seam
            between two halves rather than as the edge of one of them. */}
        <div aria-hidden className="w-px shrink-0 self-stretch bg-chalk/15" />
        <Side value={score.away} label="Away" />
      </div>
    </section>
  );
}

function Side({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <span className="scorebug text-7xl leading-none text-chalk">{value}</span>
      <span className="stat text-[10px] font-semibold uppercase tracking-widest text-dim">
        {label}
      </span>
    </div>
  );
}

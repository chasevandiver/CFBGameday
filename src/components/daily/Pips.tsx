/**
 * How far through a round you are, countable without reading.
 *
 * Generalised from `guess/GuessPips.tsx`, which hardcoded six and phrased
 * everything as guesses. Its own note is the reason it exists at all: the
 * count used to be a sentence you had to read, and pips are countable at a
 * glance, which is what a screen someone checks between plays needs.
 *
 * `lastIsLoss` keeps the one behaviour worth carrying over — when the final
 * slot is the one being spent, gold is the wrong colour, because by then the
 * sentence is "that was your last one".
 */
export function Pips({
  total,
  used,
  label,
  lastIsLoss = false,
}: {
  total: number;
  used: number;
  label: string;
  lastIsLoss?: boolean;
}) {
  const spent = Math.max(0, Math.min(used, total));
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-1.5" role="img" aria-label={`${spent} of ${total} ${label}`}>
        {Array.from({ length: total }, (_, i) => {
          const filled = i < spent;
          const last = i === total - 1;
          return (
            <span
              key={i}
              aria-hidden
              className={`h-2 w-2 rounded-full transition-colors ${
                filled ? (lastIsLoss && last ? "bg-loss" : "bg-accent") : "bg-chalk/15"
              }`}
            />
          );
        })}
      </div>
      <span aria-hidden className="stat text-[11px] font-semibold tracking-wider text-dim">
        {spent} OF {total}
      </span>
    </div>
  );
}

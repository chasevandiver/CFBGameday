import { GTG_MAX_ATTEMPTS } from "../../lib/guess-game";

/**
 * Six pips: how many guesses you have spent, at a glance.
 *
 * The count used to be a sentence ("2 left — each miss buys a clue") that you
 * had to read. Pips are countable without reading, which is the whole point
 * on a screen someone checks between plays. The last pip goes red rather than
 * gold when it is spent — by then the sentence is "that was your last one"
 * and gold does not say that.
 */
export function GuessPips({ used }: { used: number }) {
  const spent = Math.min(used, GTG_MAX_ATTEMPTS);
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex items-center gap-1.5"
        role="img"
        aria-label={`${spent} of ${GTG_MAX_ATTEMPTS} guesses used`}
      >
        {Array.from({ length: GTG_MAX_ATTEMPTS }, (_, i) => {
          const filled = i < spent;
          const last = i === GTG_MAX_ATTEMPTS - 1;
          return (
            <span
              key={i}
              aria-hidden
              className={`h-2 w-2 rounded-full transition-colors ${
                filled ? (last ? "bg-loss" : "bg-accent") : "bg-chalk/15"
              }`}
            />
          );
        })}
      </div>
      <span aria-hidden className="stat text-[11px] font-semibold tracking-wider text-dim">
        {spent} OF {GTG_MAX_ATTEMPTS}
      </span>
    </div>
  );
}

import type { GtgStats } from "../../lib/gtg-stats";

/**
 * The after-the-buzzer numbers: streak, best solve, and where your solves land.
 *
 * Folded server-side from the caller's own `gtg_guesses` rows (GTG-10), so
 * it follows the account rather than the browser. It was device-local for
 * exactly one release and the caveat line that admitted so is gone with it —
 * a disclaimer that is no longer true is worse than no disclaimer.
 */
export function StatsStrip({ stats, solvedIn }: { stats: GtgStats; solvedIn: number | null }) {
  const peak = Math.max(1, ...stats.dist);

  return (
    <section className="mt-6 border-t border-chalk/10 pt-4" aria-label="Your record">
      <div className="flex items-start justify-between gap-3">
        <Figure value={stats.streak} label="Streak" />
        <Figure value={stats.bestSolve ?? "-"} label="Best solve" />
        <Figure value={stats.solved} label="Solved" />
      </div>

      <p className="stat mt-5 mb-2 text-[10px] font-semibold uppercase tracking-widest text-chalk/45">
        Solves by guess
      </p>
      <ul className="flex flex-col gap-1">
        {stats.dist.map((n, i) => {
          const mine = solvedIn === i + 1;
          return (
            <li key={i} className="flex items-center gap-2">
              <span aria-hidden className="stat w-3 shrink-0 text-[11px] text-dim">{i + 1}</span>
              <span className="sr-only">
                {n} solved in {i + 1}
              </span>
              {/* Width off the tallest bar rather than the total, so a
                  one-solve history still draws something to look at. */}
              <span
                aria-hidden
                className={`flex h-5 min-w-5 items-center justify-end rounded-r-sm px-1.5 ${
                  mine ? "bg-accent" : "bg-chalk/12"
                }`}
                style={{ width: `${Math.max(8, (n / peak) * 100)}%` }}
              >
                <span
                  className={`stat text-[10px] font-semibold ${mine ? "text-accent-ink" : "text-dim"}`}
                >
                  {n}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <span className="scorebug text-3xl leading-none text-chalk">{value}</span>
      <span className="stat text-[10px] font-semibold uppercase tracking-widest text-dim">
        {label}
      </span>
    </div>
  );
}

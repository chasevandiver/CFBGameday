import type { Extremes, LateFlips, Streaks } from "../lib/bet-stats";

/**
 * "The season, in numbers" — one grid, two homes (GRP-9/GRP-10).
 *
 * The member page shows a group-mate's season; `/ledger` shows your own. One
 * component rather than two copies, because these tiles carry definitions
 * (what counts as a bad beat, what breaks a run) and two spellings of a
 * definition is how the same word comes to mean two things on two pages.
 */
export function SeasonNumbers({
  id,
  flips,
  run,
  ends,
}: {
  id: string;
  flips: LateFlips;
  run: Streaks;
  ends: Extremes;
}) {
  return (
    <section className="mt-6" aria-labelledby={id}>
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 id={id} className="text-sm text-accent">
          The season, in numbers
        </h2>
        <span className="h-px flex-1 bg-chalk/10" aria-hidden />
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile
          label="Bad beats"
          value={String(flips.badBeats)}
          tone={flips.badBeats > 0 ? "loss" : undefined}
          hint="Spread or total losses that were WINS in the 4th quarter — the cover left late"
        />
        <Tile
          label="Backdoors"
          value={String(flips.backdoors)}
          tone={flips.backdoors > 0 ? "win" : undefined}
          hint="Wins the late flip swung in — the ones nobody mentions at the bar"
        />
        {run.current && (
          <Tile
            label="Current run"
            value={`${run.current.length} ${run.current.kind === "win" ? "W" : "L"}${run.current.length > 1 ? "s" : ""}`}
            tone={run.current.kind}
            hint="Consecutive graded results — pushes neither extend nor break it"
          />
        )}
        <Tile
          label="Longest heater"
          value={run.longestWin > 0 ? `${run.longestWin} straight` : "—"}
          hint="Most consecutive wins this season"
        />
        <Tile
          label="Best win"
          value={ends.bestWin?.payoutUnits != null ? `+${ends.bestWin.payoutUnits.toFixed(1)}u` : "—"}
          tone={ends.bestWin ? "win" : undefined}
          hint="Largest single payout"
        />
        <Tile
          label="Worst loss"
          value={ends.worstLoss ? `−${ends.worstLoss.units.toFixed(1)}u` : "—"}
          tone={ends.worstLoss ? "loss" : undefined}
          hint="Largest single stake lost"
        />
      </dl>
    </section>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "win" | "loss";
  hint?: string;
}) {
  return (
    <div className="card px-3 py-2" title={hint}>
      <dt className="stat text-[10.5px] uppercase tracking-wide text-dim">{label}</dt>
      <dd
        className={`stat mt-0.5 text-sm ${tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : "text-chalk"}`}
      >
        {value}
      </dd>
    </div>
  );
}

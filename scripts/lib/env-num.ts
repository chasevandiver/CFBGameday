/**
 * Numeric environment variables, parsed so that "unset" and "set to nothing"
 * mean the same thing.
 *
 * They did not. `Number("")` is `0`, not `NaN`, so every guard in this repo
 * written as `Number.isNaN(v)` or `Number.isFinite(v)` waved an empty string
 * straight through as a legitimate zero:
 *
 *   - `PRESEASON_TILT_CARRY=""` silently disabled a fitted parameter
 *     (`build-preseason.ts`, P2-1 / audit 04:DQ-13 — which recorded this as
 *     fixed after closing only the NaN half).
 *   - `LINES_IDLE_DAYS=""` collapsed the idle horizon to zero days, so every
 *     lines run would idle-skip.
 *   - `CFBD_MONTHLY_BUDGET=""` set the call budget to zero, and
 *     `SCOREBOARD_INTERVAL_SECONDS=""` a zero-second poll interval.
 *
 * An empty variable is what you get from `FOO=` in a shell, a GitHub secret
 * that exists but was never filled in, and a `.env` line with nothing after
 * the `=`. All three read as "I did not set this", so that is what they mean
 * here: whitespace-only is absent, and absent takes the fallback.
 *
 * Garbage is a different case and is never silently tolerated: a value that is
 * present but unparseable, or outside the allowed range, throws. Reading
 * `LINES_IDLE_DAYS=soon` as 7 would hide a typo in a scheduler nobody watches.
 */
export function envNum(
  name: string,
  fallback: number,
  opts: { min?: number; max?: number; env?: Record<string, string | undefined> } = {},
): number {
  const raw = (opts.env ?? process.env)[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`${name}="${raw}" is not a number`);
  if (opts.min !== undefined && v < opts.min)
    throw new Error(`${name}="${raw}" is below the minimum of ${opts.min}`);
  if (opts.max !== undefined && v > opts.max)
    throw new Error(`${name}="${raw}" is above the maximum of ${opts.max}`);
  return v;
}

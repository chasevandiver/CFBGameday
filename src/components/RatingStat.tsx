import { describePlacement, rankAndPercentile } from "../lib/rankings";
import { formatRating, RATING_SCALES, type RatingSystem } from "../lib/rating-scales";

/**
 * A single-value meter: where this team sits between the worst and best of the
 * field, with a tick at the median so "above average" is visible rather than
 * inferred.
 *
 * Promoted from the private `WinBar` on /team/[id], which was the same 6px
 * rounded track and accent fill without a label. The whole thing is one
 * `role="img"` — three separate spans get read out as fragments.
 */
export function PercentileMeter({
  percentile,
  label,
  width = "w-full",
}: {
  percentile: number;
  label: string;
  width?: string;
}) {
  const pct = Math.max(0, Math.min(1, percentile)) * 100;
  return (
    <span
      role="img"
      aria-label={label}
      className={`relative block h-1.5 overflow-hidden rounded-full bg-elev ${width}`}
    >
      <span
        className="block h-full rounded-full bg-accent"
        style={{ width: `${pct}%` }}
        aria-hidden
      />
      {/* median tick: without it the bar shows a position but no reference */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px bg-background/70"
      />
    </span>
  );
}

/**
 * A rating with the three things a bare number is missing: what it measures,
 * what the scale is, and where this team sits against the field.
 *
 * `field` is every other team's value on the same system. Without it the stat
 * still renders — it just can't place the team, which is honest for a system
 * we only hold for the two teams in one game.
 */
export function RatingStat({
  system,
  value,
  field,
  compact = false,
}: {
  system: RatingSystem;
  value: number | null;
  field?: number[];
  /** Card-sized: label, value and rank on one line, no blurb. */
  compact?: boolean;
}) {
  const scale = RATING_SCALES[system];
  if (value === null) {
    return (
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-dim">{scale.label}</span>
        <span className="stat text-sm text-chalk/30">—</span>
      </div>
    );
  }

  const placement = field && field.length > 1 ? rankAndPercentile(field, value) : null;

  if (compact) {
    return (
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-dim">{scale.label}</span>
        <span className="stat text-sm font-semibold text-chalk">
          {formatRating(system, value)}
          {placement && (
            <span className="ml-1.5 text-[11px] font-medium text-chalk/45">
              #{placement.rank}
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-chalk/50">
          {scale.label}
        </span>
        <span className="stat text-base font-semibold text-chalk">
          {formatRating(system, value)}
        </span>
      </div>
      {placement && (
        <>
          <PercentileMeter
            percentile={placement.percentile}
            label={`${scale.label} ${formatRating(system, value)} — rank ${placement.rank} of ${placement.of}, ${describePlacement(placement)}`}
          />
          <div className="flex items-baseline justify-between gap-2">
            <span className="stat text-[11px] text-dim">
              #{placement.rank} of {placement.of}
            </span>
            <span className="stat text-[11px] text-chalk/45">{describePlacement(placement)}</span>
          </div>
        </>
      )}
      {/* The scale, on the page rather than in a title attribute a phone
          cannot show. */}
      <p className="text-[11px] leading-snug text-dim">{scale.blurb}</p>
    </div>
  );
}

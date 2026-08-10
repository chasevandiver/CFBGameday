/**
 * Cumulative-units line, server-rendered SVG — no chart lib, no client JS.
 *
 * Lifted out of the ledger so the home hub can show the same curve from the
 * same numbers (`cumulativeUnits` in `lib/records.ts`). `preserveAspectRatio`
 * is "none" on purpose: the shape carries the story, the aspect ratio doesn't,
 * and a fixed height is what keeps the card from resizing as bets settle.
 */
export function UnitsCurve({ points }: { points: number[] }) {
  const w = 320;
  const h = 64;
  const pad = 4;
  const all = [0, ...points];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (all.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const d = all.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-16 w-full"
      role="img"
      aria-label={`Cumulative units over ${points.length} graded bets, currently ${last >= 0 ? "+" : ""}${last.toFixed(1)}`}
    >
      <line
        x1={pad}
        x2={w - pad}
        y1={y(0)}
        y2={y(0)}
        stroke="var(--line-strong)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <path
        d={d}
        fill="none"
        stroke={last >= 0 ? "var(--win)" : "var(--loss)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

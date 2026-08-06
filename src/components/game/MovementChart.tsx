import { DEFAULT_TZ, kickDateLong, kickParts } from "../../lib/kick";
import type { LinePoint } from "../../lib/slate";
import { fmtSpread } from "../../lib/slate";

/**
 * Line-movement chart with a real time axis — open on the left, latest on the
 * right, stepped like the market actually moves. Server-rendered SVG, no
 * client JS (audit #27: the game page only had an unlabeled 72px squiggle).
 */
export function MovementChart({ points }: { points: LinePoint[] }) {
  if (points.length < 3) return null;

  const w = 640;
  const h = 120;
  const padX = 8;
  const padTop = 10;
  const padBottom = 22;

  const times = points.map((p) => Date.parse(p.t));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = t1 - t0 || 1;
  const vals = points.map((p) => p.v);
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);
  // at least a 2-point window so a half-point drift doesn't render as a cliff
  const mid = (vMin + vMax) / 2;
  const vLo = Math.min(vMin, mid - 1);
  const vHi = Math.max(vMax, mid + 1);

  const x = (t: number) => padX + ((t - t0) / span) * (w - padX * 2);
  const y = (v: number) =>
    padTop + (1 - (v - vLo) / (vHi - vLo)) * (h - padTop - padBottom);

  // stepped path: the line holds until the next observed change
  let d = `M${x(times[0]).toFixed(1)},${y(points[0].v).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H${x(times[i]).toFixed(1)} V${y(points[i].v).toFixed(1)}`;
  }
  d += ` H${(w - padX).toFixed(1)}`;

  const first = points[0];
  const last = points[points.length - 1];
  const gridVals = [...new Set([vMin, vMax])];

  return (
    <figure className="px-4 pb-3">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-28 w-full"
        role="img"
        aria-label={`Spread movement from ${fmtSpread(first.v)} at open to ${fmtSpread(last.v)} now`}
      >
        {gridVals.map((v) => (
          <g key={v}>
            <line
              x1={padX}
              x2={w - padX}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--line)"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <text
              x={w - padX}
              y={y(v) - 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--text-dim)"
              fontFamily="var(--font-numeric), monospace"
            >
              {fmtSpread(v)}
            </text>
          </g>
        ))}
        <path
          d={d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <circle key={i} cx={x(times[i])} cy={y(p.v)} r="2" fill="var(--accent)" />
        ))}
        <text
          x={padX}
          y={h - 7}
          fontSize="10"
          fill="var(--text-dim)"
          fontFamily="var(--font-numeric), monospace"
        >
          {kickDateLong(first.t, DEFAULT_TZ)} {kickParts(first.t, DEFAULT_TZ).time} · open{" "}
          {fmtSpread(first.v)}
        </text>
        <text
          x={w - padX}
          y={h - 7}
          textAnchor="end"
          fontSize="10"
          fill="var(--text-dim)"
          fontFamily="var(--font-numeric), monospace"
        >
          now {fmtSpread(last.v)} · {kickDateLong(last.t, DEFAULT_TZ)}{" "}
          {kickParts(last.t, DEFAULT_TZ).time}
        </text>
      </svg>
      <figcaption className="sr-only">
        Consensus spread over time, home perspective.
      </figcaption>
    </figure>
  );
}

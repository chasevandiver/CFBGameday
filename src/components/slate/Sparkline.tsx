import type { LinePoint } from "../../lib/slate";

/**
 * Tiny inline line-movement chart. Stroke turns win/loss colored by whether
 * the line moved toward the home side (down) or away (up) since open.
 */
export function Sparkline({
  points,
  width = 56,
  height = 18,
}: {
  points: LinePoint[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(pad + i * step).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pad + (points.length - 1) * step} cy={y(last.v)} r="2" fill="currentColor" />
    </svg>
  );
}

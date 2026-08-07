import type { LinePoint } from "../../lib/slate";

/**
 * Tiny inline line-movement chart — the shape of the move, next to
 * MoveIndicator's arrow and magnitude.
 *
 * The stroke inherits `currentColor`, so the caller decides the tone. It used
 * to be rendered inside a `text-dim` row while its own doc comment claimed it
 * colored itself win/loss by direction (audit bug #15) — the comment was
 * wrong AND the chart was invisible.
 *
 * Direction alone is deliberately NOT colored. Green for "moved toward home"
 * would imply a valence that doesn't exist: there is no rooting interest until
 * the model takes a side. `vsModel` is the read that means something — the same
 * one MoveIndicator uses — so the pair now agrees instead of one being a
 * decoration.
 */
export function Sparkline({
  points,
  vsModel = null,
  width = 56,
  height = 18,
}: {
  points: LinePoint[];
  /** Market steaming toward or away from the model's side; null = no read. */
  vsModel?: "toward" | "away" | null;
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

  // No read → chalk, not dim: the shape still has to be legible.
  const tone =
    vsModel === "toward" ? "text-win" : vsModel === "away" ? "text-loss" : "text-chalk/55";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`overflow-visible ${tone}`}
      aria-hidden
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pad + (points.length - 1) * step} cy={y(last.v)} r="2" fill="currentColor" />
    </svg>
  );
}

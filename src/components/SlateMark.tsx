import { LACE_W, MARK_CANVAS, SEAM_LACES, SEAM_PATH, S_PATH } from "../lib/brand";

/**
 * The Slate S, for use inside the app.
 *
 * Same geometry as the exported icons — both read it out of src/lib/brand.ts,
 * because two copies of a logo drift and you find out on a phone. What is
 * dropped here is the field, the lighting and the dimensional edge: at 24px
 * none of that survives, and a mark carrying artwork it cannot show reads as
 * mud.
 *
 * The letter takes `currentColor` rather than chalk so it inherits whatever it
 * is set on. That is what makes it legal in light mode: the brand puts a chalk
 * S on dark, and the light theme's ink is the same relationship inverted. Only
 * the seam is pinned to the accent — the gold is the part that has to stay gold.
 */
export function SlateMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${MARK_CANVAS} ${MARK_CANVAS}`}
      width={size}
      height={size}
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d={S_PATH} fill="currentColor" />
      <g fill="var(--accent)">
        <path d={SEAM_PATH} />
        {SEAM_LACES.map(([x, y, h, deg]) => (
          <rect
            key={x}
            x={x - LACE_W / 2}
            y={y - h / 2}
            width={LACE_W}
            height={h}
            rx={5}
            transform={`rotate(${deg} ${x} ${y})`}
          />
        ))}
      </g>
    </svg>
  );
}

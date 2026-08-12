import {
  MARK_ASPECT,
  MARK_LETTER_PATH,
  MARK_SEAM_PATH,
  MARK_VIEWBOX,
} from "../lib/brand-mark-outline";

/**
 * The Slate S, inline.
 *
 * Traced off the supplied artwork (scripts/trace-brand-mark.ts), so the
 * letterform is exact — but flat: no bevel, no grain, no rim light. That is
 * deliberate. This renders at 20–28px in the header, where every one of those
 * would be a smudge, and it has to survive both themes.
 *
 * The letter takes `currentColor`, which is what makes it legal in light mode:
 * the brand puts a chalk S on a dark field, and the light theme is that same
 * relationship inverted. Only the seam is pinned to the accent — the gold is
 * the half that has to stay gold.
 *
 * For anything that can carry the full artwork — home-screen tiles, the splash,
 * share cards — use the raster instead. This is the small, tintable cut.
 */
export function SlateMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      height={size}
      width={Math.round(size * MARK_ASPECT)}
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d={MARK_LETTER_PATH} fill="currentColor" fillRule="evenodd" />
      <path d={MARK_SEAM_PATH} fill="var(--accent)" fillRule="evenodd" />
    </svg>
  );
}

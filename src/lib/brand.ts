/**
 * The approved brand palette (Brand System v1.0 §5).
 *
 * This is the identity palette — the icon, the manifest, the launch surfaces,
 * the share cards. It is deliberately NOT the app's runtime palette: the UI
 * still runs on the charcoal tokens in globals.css, and moving those to green
 * is a separate, whole-product change (docs/STATUS.md, BRAND-2).
 *
 * Keep this the only place these hex values are written down. scripts/lib/
 * brand-mark.ts draws from it, app/manifest.ts and app/layout.tsx colour the
 * launch chrome from it, and the OG card stamps it.
 */
export const BRAND = {
  /** Primary background. Deep enough to sit on an OLED home screen. */
  nearBlack: "#020A08",
  /** Field green — the brand's base surface. */
  fieldGreen: "#08251C",
  /** Raised field green — elevated surfaces, the icon's green pool. */
  raisedGreen: "#0E3B2C",
  /** Chalk. Printed-program white, never pure #fff. */
  chalk: "#F4EFE2",
  /** Goalpost gold — the accent, used sparingly. */
  gold: "#E8B93D",
  /** Penalty orange. Negative and warning states only, under 2% of any surface. */
  penaltyOrange: "#E4572E",
} as const;

/* ── The mark's geometry ──────────────────────────────────────────────────
   Drawn on a 1024 grid. Lives here rather than in the build script because
   both the exported icons and the in-app <SlateMark> have to be the same
   letter — two copies of a logo drift, and you find out on a phone. */

/** The master grid the coordinates below are on. */
export const MARK_CANVAS = 1024;

/**
 * The block S, as one closed outline.
 *
 * 118-unit bars on a 424×628 box centred on the canvas, outer corners cut at
 * 45° (38 units), terminal inner corners cut smaller (22), reflex corners left
 * sharp — that last part is what makes it read as varsity block rather than a
 * rounded geometric S. Counters are 306×138, matched top and bottom, so the
 * letter is symmetric under 180° rotation.
 *
 * Farthest vertex from centre is 359 units, inside the 409.6 Android maskable
 * safe radius, so one path serves every export.
 */
export const S_PATH =
  "M338 198 L686 198 L724 236 L724 294 L702 316 L418 316 L418 454 L702 454 L724 476 L724 788 L686 826 L338 826 L300 788 L300 730 L322 708 L606 708 L606 572 L322 572 L300 550 L300 236 Z";

/**
 * The football seam: a crescent across the S's middle bar, entering inside the
 * letter on the left and breaking past its right edge into the dark. The ends
 * are points, not caps — a seam, not a stroke.
 */
export const SEAM_PATH =
  "M360 514 C 480 466 672 480 816 578 C 664 526 476 534 360 514 Z";

/** Laces: centre x, centre y, height, and the seam angle they sit square to. */
export const SEAM_LACES: ReadonlyArray<
  readonly [x: number, y: number, h: number, deg: number]
> = [
  [486, 509, 54, 2],
  [522, 510, 60, 3],
  [558, 512, 64, 4],
  [594, 516, 64, 7],
  [630, 522, 60, 9],
  [666, 528, 54, 11],
];

/** Lace width. Paired with SEAM_LACES to place each rect. */
export const LACE_W = 14;

/**
 * The mark as a bare two-colour SVG string, for places that can only take an
 * image — the OG card renderer being the one that matters. No gradients, no
 * filters, no background: at stamp size none of it would show anyway.
 */
export function slateMarkSvg(letter: string = BRAND.chalk, seam: string = BRAND.gold): string {
  const laces = SEAM_LACES.map(
    ([x, y, h, deg]) =>
      `<rect x="${x - LACE_W / 2}" y="${y - h / 2}" width="${LACE_W}" height="${h}" rx="5" transform="rotate(${deg} ${x} ${y})"/>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_CANVAS} ${MARK_CANVAS}"><path d="${S_PATH}" fill="${letter}"/><g fill="${seam}"><path d="${SEAM_PATH}"/>${laces}</g></svg>`;
}

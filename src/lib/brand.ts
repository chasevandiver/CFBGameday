/**
 * The approved brand palette (Brand System v1.0 §5).
 *
 * This is the identity palette — the icon, the manifest, the launch surfaces,
 * the share cards. It is deliberately NOT the app's runtime palette: the UI
 * still runs on the charcoal tokens in globals.css, and moving those to green
 * is a separate, whole-product change (docs/STATUS.md, BRAND-2).
 *
 * Keep this the only place these hex values are written down. The icon itself
 * is not built from them — it is supplied artwork, see
 * public/brand/slate-icon-source.png — but the manifest, the launch chrome, the
 * splash ground and the share cards all colour themselves from here.
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

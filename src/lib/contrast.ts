/**
 * WCAG contrast, computed from the real stylesheet.
 *
 * `docs/STATUS.md`'s Aug 21 quality floor says contrast changes are "computed,
 * never eyeballed", and UX-06's residue names three suspects by feel: light
 * `chalk/50–55` table headers, dark `/35–/45` decorative labels, edge-on-card.
 * A number settles each of them, and — more usefully — a number that lives in a
 * test settles them again every time someone touches the palette.
 *
 * This reads `src/app/globals.css` rather than restating the tokens, because a
 * second copy of a colour is how a palette and its accessibility guarantee stop
 * agreeing. Change `--text` and the assertions move with it.
 *
 * ## What the thresholds mean
 *
 * WCAG 2.1 AA is **4.5:1** for body text and **3:1** for large text (≥24px, or
 * ≥18.66px bold) and for non-text things like focus rings and control borders
 * (SC 1.4.11). Almost every muted label in this app is 9–14px, so 4.5 is the
 * bar that applies and the 3:1 exemption is not available to it.
 */

export interface ThemeTokens {
  bg: string;
  surface: string;
  text: string;
  dim: string;
  accent: string;
  edge: string;
  push: string;
  /** The `color-mix` share of `--surface` in `--glass-surface`, 0–1. */
  glass: number;
}

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ] as const;
}

/** `fg` drawn at `alpha` over an opaque `bg` — what Tailwind's `/NN` does. */
export function overlay(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ] as const;
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as unknown as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The colour a `.card` actually paints, which is NOT `--surface`.
 *
 * `--glass-surface` is `color-mix(in srgb, var(--surface) NN%, transparent)`
 * over the page, so the face is a blend and every ratio measured against
 * `--surface` alone is measuring a surface no pixel on screen has. In dark mode
 * that is the difference between #241d16 and #201a14.
 */
export function cardFace(t: ThemeTokens): Rgb {
  return overlay(hexToRgb(t.surface), hexToRgb(t.bg), t.glass);
}

const HEX = (css: string, name: string, from: number): string => {
  const m = css.slice(from).match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`contrast: --${name} not found in globals.css`);
  return m[1];
};

/**
 * Pull the two themes out of `globals.css`. Deliberately narrow: it reads the
 * handful of tokens the assertions need and throws on anything missing, rather
 * than building a general CSS parser that would fail silently when a name
 * changes.
 */
export function parseThemes(css: string): { dark: ThemeTokens; light: ThemeTokens } {
  /* Anchored to the RULE, not the name. `indexOf('html[data-theme="light"]')`
     finds the file's own header comment first — it explains the toggle in
     prose — so the light read started before `:root` and returned the dark
     palette for both themes. Every light-mode assertion then measured dark
     mode and passed for the wrong reason. Requiring a line start and an opening
     brace is what makes this the selector rather than a mention of it. */
  const lightAt = css.search(/^html\[data-theme="light"\]\s*\{/m);
  if (lightAt < 0) throw new Error("contrast: light theme block not found");

  const glassAt = (from: number): number => {
    const m = css
      .slice(from)
      .match(/--glass-surface:\s*color-mix\(in srgb, var\(--surface\) (\d+)%/);
    if (!m) throw new Error("contrast: --glass-surface not found");
    return Number(m[1]) / 100;
  };

  const read = (from: number): ThemeTokens => ({
    bg: HEX(css, "bg", from),
    surface: HEX(css, "surface", from),
    text: HEX(css, "text", from),
    dim: HEX(css, "text-dim", from),
    accent: HEX(css, "accent", from),
    edge: HEX(css, "edge-c", from),
    push: HEX(css, "push", from),
    glass: glassAt(from),
  });

  return { dark: read(0), light: read(lightAt) };
}

/** Contrast of `text-chalk/NN` on the card face. */
export function chalkOnCard(t: ThemeTokens, opacityPct: number): number {
  const face = cardFace(t);
  return contrastRatio(overlay(hexToRgb(t.text), face, opacityPct / 100), face);
}

/** The lowest `/NN` step on the ladder that clears `min` on the card face. */
export function lowestPassingStep(t: ThemeTokens, steps: readonly number[], min: number): number {
  const ok = [...steps].sort((a, b) => a - b).find((s) => chalkOnCard(t, s) >= min);
  if (ok === undefined) throw new Error("contrast: no step on the ladder clears the threshold");
  return ok;
}

/** The `/NN` steps actually used in the codebase, low to high. */
export const CHALK_STEPS = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 100] as const;

/** WCAG 2.1 AA. */
export const AA_TEXT = 4.5;
/** WCAG 2.1 AA for large text, and SC 1.4.11 for focus rings and control edges. */
export const AA_LARGE_OR_UI = 3;

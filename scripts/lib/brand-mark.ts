/**
 * The Slate S — vector master for the brand identity.
 *
 * Everything ships from here: the 1024 master, the Android maskable variant,
 * the 32px favicon, the transparent in-app mark, and the iOS splash art. One
 * geometry, one set of colours, rendered at different detail levels — nothing
 * is redrawn per size, which is the whole point of a master.
 *
 * The hierarchy the brand spec asks for is literal in the layer order below:
 * S → football seam → field → gold edge. At 60px only the first two survive,
 * and that is by design; the field markings are texture and are allowed to
 * disappear.
 *
 * No <text> anywhere. The yard numbers are built from rectangles so the master
 * has no font dependency and needs no outlining step before it opens in a
 * vector editor.
 */

import {
  BRAND,
  LACE_W,
  MARK_CANVAS,
  SEAM_LACES,
  SEAM_PATH,
  S_PATH,
} from "../../src/lib/brand";

export { BRAND, S_PATH };

/** How much of the artwork to draw. `simple` is the small-size cut. */
type Detail = "full" | "simple";

/** Shades derived from the palette for dimensional edges — not new brand colours. */
const GOLD_DEEP = "#8C6A1C";
const GOLD_LIT = "#F6D579";
const CHALK_LIT = "#FBF8F0";
const CHALK_SHADE = "#DED5BF";
const FIELD_LINE = "#6FCBA4";

/* ── Yard numbers ───────────────────────────────────────────────────────────
   Segment-built digits. Scoreboard numerals rather than a grotesque, which is
   both easier to trust at 6% opacity and closer to the painted-field / old
   scoreboard reference the brand is drawing on. */

const DIGIT_W = 32;
const DIGIT_H = 46;
const BAR = 9;

/** Segment rectangles on a DIGIT_W × DIGIT_H cell, keyed the usual a–g way. */
const SEGMENTS: Record<string, readonly [number, number, number, number]> = {
  a: [0, 0, DIGIT_W, BAR],
  b: [DIGIT_W - BAR, 0, BAR, DIGIT_H / 2 + BAR / 2],
  c: [DIGIT_W - BAR, DIGIT_H / 2 - BAR / 2, BAR, DIGIT_H / 2 + BAR / 2],
  d: [0, DIGIT_H - BAR, DIGIT_W, BAR],
  e: [0, DIGIT_H / 2 - BAR / 2, BAR, DIGIT_H / 2 + BAR / 2],
  f: [0, 0, BAR, DIGIT_H / 2 + BAR / 2],
  g: [0, DIGIT_H / 2 - BAR / 2, DIGIT_W, BAR],
};

const DIGIT_SEGMENTS: Record<string, string> = {
  "0": "abcdef",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
};

/** "1" is a bare stem — a segment "1" reads as a floating tick on a field. */
function digit(d: string, x: number, y: number): string {
  if (d === "1") {
    return `<rect x="${round(x + (DIGIT_W - BAR) / 2)}" y="${round(y)}" width="${BAR}" height="${DIGIT_H}"/>`;
  }
  return [...DIGIT_SEGMENTS[d]]
    .map((s) => {
      const [sx, sy, sw, sh] = SEGMENTS[s];
      return `<rect x="${round(x + sx)}" y="${round(y + sy)}" width="${round(sw)}" height="${round(sh)}"/>`;
    })
    .join("");
}

function number(text: string, x: number, cy: number): string {
  const gap = 9;
  return [...text]
    .map((d, i) => digit(d, x + i * (DIGIT_W + gap), cy - DIGIT_H / 2))
    .join("");
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/* ── Layers ─────────────────────────────────────────────────────────────── */

/**
 * The sideline rail. Major stripes every 88 units off the 50 (dead centre),
 * minors halfway between, numbers on the upper half only — the way you'd see
 * one sideline of a field, and deliberately not league-specific: no NCAA hash
 * geometry, no NFL numerals.
 */
function fieldMarkings(): string {
  const majors: string[] = [];
  const minors: string[] = [];
  for (let y = 160; y <= 864; y += 44) {
    const isMajor = (y - 160) % 88 === 0;
    const [w, h] = isMajor ? [58, 6] : [30, 5];
    const left = 138 + (isMajor ? 0 : 14);
    const right = MARK_CANVAS - left - w;
    const row = `<rect x="${left}" y="${round(y - h / 2)}" width="${w}" height="${h}"/><rect x="${right}" y="${round(y - h / 2)}" width="${w}" height="${h}"/>`;
    (isMajor ? majors : minors).push(row);
  }

  const labels = ["10", "20", "30", "40", "50"]
    .map((n, i) => number(n, 200, 160 + i * 88))
    .join("");

  return `
  <g fill="${FIELD_LINE}">
    <g opacity="0.095">${majors.join("")}</g>
    <g opacity="0.06">${minors.join("")}</g>
    <g opacity="0.075">${labels}</g>
    <g opacity="0.085">
      <rect x="509" y="118" width="6" height="44"/>
      <rect x="509" y="862" width="6" height="44"/>
    </g>
  </g>
  <g fill="${BRAND.gold}" opacity="0.34">
    <path d="M150 499 L172 512 L150 525 Z"/>
    <path d="M874 499 L852 512 L874 525 Z"/>
  </g>`;
}

function background(p: string, detail: Detail): string {
  return `
  <rect width="${MARK_CANVAS}" height="${MARK_CANVAS}" fill="${BRAND.nearBlack}"/>
  <rect width="${MARK_CANVAS}" height="${MARK_CANVAS}" fill="url(#${p}bg)"/>
  ${detail === "full" ? `<rect width="${MARK_CANVAS}" height="${MARK_CANVAS}" fill="url(#${p}vignette)"/>` : ""}
  <rect width="${MARK_CANVAS}" height="${MARK_CANVAS}" fill="url(#${p}lightGreen)"/>
  <rect width="${MARK_CANVAS}" height="${MARK_CANVAS}" fill="url(#${p}lightGold)"/>`;
}

/**
 * The letter. Three passes: a gold extrude offset down-right (the dimensional
 * edge), the chalk face, and a gold hairline that keeps the silhouette defined
 * where the face meets the dark field.
 */
function slateS(p: string, detail: Detail): string {
  const shadow = detail === "full" ? ` filter="url(#${p}drop)"` : "";
  return `
  <g${shadow}>
    <g transform="translate(9 12)"><path d="${S_PATH}" fill="url(#${p}goldEdge)"/></g>
    <path d="${S_PATH}" fill="url(#${p}chalk)"/>
    <path d="${S_PATH}" fill="none" stroke="${BRAND.gold}" stroke-opacity="0.24" stroke-width="2.5"/>
  </g>`;
}

function seam(p: string, detail: Detail): string {
  const laces = SEAM_LACES.map(
    ([x, y, h, deg]) =>
      `<rect x="${round(x - LACE_W / 2)}" y="${round(y - h / 2)}" width="${LACE_W}" height="${h}" rx="5" transform="rotate(${deg} ${x} ${y})"/>`,
  ).join("");

  // The seam is cut into the letter, not laid on top of it: a dark copy sits
  // under the gold so the chalk face reads as displaced rather than painted.
  const cut =
    detail === "full"
      ? `<g transform="translate(0 7)" fill="#3D2E08" opacity="0.34"><path d="${SEAM_PATH}"/>${laces}</g>`
      : "";

  return `
  ${cut}
  <g fill="url(#${p}goldSeam)">
    <path d="${SEAM_PATH}"/>
    ${laces}
  </g>`;
}

function defs(p: string, detail: Detail): string {
  return `
  <defs>
    <radialGradient id="${p}bg" cx="0.28" cy="0.22" r="0.80">
      <stop offset="0" stop-color="${BRAND.raisedGreen}"/>
      <stop offset="0.34" stop-color="${BRAND.fieldGreen}"/>
      <stop offset="0.80" stop-color="${BRAND.nearBlack}"/>
      <stop offset="1" stop-color="${BRAND.nearBlack}"/>
    </radialGradient>
    <radialGradient id="${p}vignette" cx="0.5" cy="0.5" r="0.72">
      <stop offset="0.40" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.52"/>
    </radialGradient>
    <linearGradient id="${p}lightGreen" x1="0" y1="0" x2="0.62" y2="0.62">
      <stop offset="0" stop-color="#7FE3B8" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#7FE3B8" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${p}lightGold" x1="1" y1="1" x2="0.42" y2="0.42">
      <stop offset="0" stop-color="${BRAND.gold}" stop-opacity="0.13"/>
      <stop offset="1" stop-color="${BRAND.gold}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${p}chalk" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="${CHALK_LIT}"/>
      <stop offset="0.55" stop-color="${BRAND.chalk}"/>
      <stop offset="1" stop-color="${CHALK_SHADE}"/>
    </linearGradient>
    <linearGradient id="${p}goldEdge" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="${GOLD_DEEP}"/>
      <stop offset="1" stop-color="${BRAND.gold}"/>
    </linearGradient>
    <linearGradient id="${p}goldSeam" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${GOLD_LIT}"/>
      <stop offset="0.5" stop-color="${BRAND.gold}"/>
      <stop offset="1" stop-color="#C08F1E"/>
    </linearGradient>
    ${
      detail === "full"
        ? `<filter id="${p}drop" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#000000" flood-opacity="0.55"/>
    </filter>`
        : ""
    }
  </defs>`;
}

export interface MarkOptions {
  /** `full` = master artwork. `simple` = favicon/small: no field, no filters. */
  detail?: Detail;
  /** Omit the field/background entirely — the transparent in-app mark. */
  background?: boolean;
  /** Scale the S and seam about the canvas centre. 1.07 is the master; the
   *  maskable export pulls it in, the favicon pushes it out. */
  foregroundScale?: number;
  /** Unique per inlined instance, so two marks on one page don't share gradient ids. */
  idPrefix?: string;
  /** Rendered width/height attributes. The viewBox is always 1024. */
  size?: number;
}

/** The mark, as a standalone SVG document. */
export function buildMark(opts: MarkOptions = {}): string {
  const {
    detail = "full",
    background: bg = true,
    foregroundScale = 1.07,
    idPrefix = "s",
    size,
  } = opts;

  const dim = size ? ` width="${size}" height="${size}"` : "";
  const fgOpen =
    foregroundScale === 1
      ? "<g>"
      : `<g transform="translate(512 512) scale(${foregroundScale}) translate(-512 -512)">`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_CANVAS} ${MARK_CANVAS}"${dim}>
${defs(idPrefix, detail)}
${bg ? background(idPrefix, detail) : ""}
${bg && detail === "full" ? fieldMarkings() : ""}
  ${fgOpen}
${slateS(idPrefix, detail)}
${seam(idPrefix, detail)}
  </g>
</svg>
`;
}

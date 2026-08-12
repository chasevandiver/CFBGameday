/**
 * Renders every brand asset from the one vector master in scripts/lib/brand-mark.ts.
 *
 *   npx tsx scripts/build-brand-assets.ts
 *
 * Nothing here is hand-drawn per size — that is the rule the brand spec is
 * strictest about. Change the master, re-run this, commit what moves.
 *
 * Writes:
 *   public/brand/*.svg          vector master, maskable, favicon, transparent mark, wordmark
 *   public/brand/contact-sheet.html   the mandatory small-size test, on near-black
 *   public/icons/*.png          1024 / 512 / 192 / 180 / 32 + maskable 512 / 192
 *   public/splash/*.png         iOS startup images, portrait, per device
 *   src/app/favicon.ico         16 / 32 / 48
 *   src/app/apple-icon.png      180, the iOS home-screen tile
 *   src/lib/apple-startup-images.ts   device table the layout renders <link>s from
 *
 * Fonts: the wordmark is outlined at build time from Graduate and IBM Plex Mono
 * (both OFL, fetched from Google Fonts and cached in .brand-cache/). The
 * committed SVG and PNGs carry outlines only — no font dependency ships.
 */

import { Resvg } from "@resvg/resvg-js";
import opentype from "opentype.js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BRAND, buildMark } from "./lib/brand-mark";

const ROOT = join(import.meta.dirname, "..");
const CACHE = join(ROOT, ".brand-cache");

const out = (...p: string[]) => {
  const path = join(ROOT, ...p);
  mkdirSync(join(path, ".."), { recursive: true });
  return path;
};

function writeSvg(path: string, svg: string) {
  writeFileSync(out(path), svg);
  console.log(`  ${path}`);
}

function png(svg: string, width: number): Buffer {
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng(),
  );
}

function writePng(path: string, svg: string, width: number) {
  const data = png(svg, width);
  writeFileSync(out(path), data);
  console.log(`  ${path}  ${(data.length / 1024).toFixed(0)} KB`);
  return data;
}

/* ── Variants ─────────────────────────────────────────────────────────────
   Four, and only four. Everything exported below is one of these at a size. */

/** The master: full field, numbers, lighting, dimensional S. Full bleed. */
const MASTER = buildMark({ idPrefix: "m" });

/**
 * Android maskable. Same artwork, foreground pulled to 0.94 so the S sits at
 * 82% of the 80% safe circle — the field markings are decorative and are
 * allowed to be cropped, the S and seam are not.
 */
const MASKABLE = buildMark({ idPrefix: "k", foregroundScale: 0.94 });

/**
 * 32px and below. No field, no numbers, no drop shadow — all of it turns to
 * mud at that size — and the S pushed out to 1.16 to hold contrast in a tab.
 */
const FAVICON = buildMark({ idPrefix: "f", detail: "simple", foregroundScale: 1.16 });

/** Transparent mark for in-app use, where the app supplies the ground. */
const MARK = buildMark({ idPrefix: "n", background: false, detail: "simple" });

/** Same mark with its shadow and seam cut intact — the splash has room for depth. */
const MARK_FULL = buildMark({ idPrefix: "p", background: false, detail: "full" });

/* ── Wordmark ─────────────────────────────────────────────────────────────── */

const FONTS = {
  graduate: {
    url: "https://fonts.gstatic.com/s/graduate/v19/C8cg4cs3o2n15t_2YxgR.ttf",
    file: "Graduate-Regular.ttf",
  },
  plexMono: {
    url: "https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJ8lc.ttf",
    file: "IBMPlexMono-Medium.ttf",
  },
} as const;

async function loadFont(key: keyof typeof FONTS): Promise<opentype.Font> {
  const { url, file } = FONTS[key];
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    mkdirSync(CACHE, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${file}: ${res.status} ${res.statusText}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return opentype.parse(readFileSync(path).buffer as ArrayBuffer);
}

/**
 * Set a line as outlines with letter-spacing. opentype's getPath has no
 * tracking, so glyphs are advanced by hand — which is what the wordmark needs
 * anyway: display caps at this size want air between them.
 */
function setLine(
  font: opentype.Font,
  text: string,
  fontSize: number,
  tracking: number,
): { d: string; width: number; height: number } {
  const scale = fontSize / font.unitsPerEm;
  const path = new opentype.Path();
  let x = 0;
  const glyphs = font.stringToGlyphs(text);
  glyphs.forEach((glyph, i) => {
    path.extend(glyph.getPath(x, 0, fontSize));
    x += glyph.advanceWidth! * scale;
    if (i < glyphs.length - 1) x += tracking;
  });
  return {
    d: path.toPathData(2),
    width: x,
    height: (font.ascender - font.descender) * scale,
  };
}

/** THE CFB SLATE, outlined, chalk, on a transparent ground. */
async function buildWordmark(): Promise<string> {
  const graduate = await loadFont("graduate");
  const line = setLine(graduate, "THE CFB SLATE", 100, 9);
  const pad = 6;
  // Cap height, not the full em box: the wordmark's box should be the letters.
  const capTop = -(graduate.tables.os2.sCapHeight ?? 700) * (100 / graduate.unitsPerEm);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${capTop - pad} ${line.width + pad * 2} ${-capTop + pad * 2}">
  <title>The CFB Slate</title>
  <path d="${line.d}" fill="${BRAND.chalk}"/>
</svg>
`;
}

/* ── favicon.ico ──────────────────────────────────────────────────────────── */

/**
 * ICO wrapping PNG payloads. Every browser that matters has read PNG-in-ICO
 * since 2007, and it keeps the file a tenth the size of BMP entries.
 */
function buildIco(entries: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = entries.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });

  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

/* ── iOS startup images ───────────────────────────────────────────────────── */

/**
 * Portrait only. Landscape startup images on iPhone are ignored by iOS and on
 * iPad the app is very rarely launched to a cold splash in landscape — the
 * cost is another dozen PNGs in the repo for a frame most users never see.
 */
const DEVICES: ReadonlyArray<{ id: string; w: number; h: number; dpr: number; note: string }> = [
  { id: "iphone-xr", w: 414, h: 896, dpr: 2, note: "iPhone 11, XR" },
  { id: "iphone-x", w: 375, h: 812, dpr: 3, note: "iPhone 11 Pro, 12 mini, 13 mini, X, XS" },
  { id: "iphone-xs-max", w: 414, h: 896, dpr: 3, note: "iPhone 11 Pro Max, XS Max" },
  { id: "iphone-12", w: 390, h: 844, dpr: 3, note: "iPhone 12, 13, 14" },
  { id: "iphone-12-pro-max", w: 428, h: 926, dpr: 3, note: "iPhone 12/13 Pro Max, 14 Plus" },
  { id: "iphone-14-pro", w: 393, h: 852, dpr: 3, note: "iPhone 14 Pro, 15, 15 Pro, 16" },
  { id: "iphone-14-pro-max", w: 430, h: 932, dpr: 3, note: "iPhone 14/15 Pro Max, 15 Plus, 16 Plus" },
  { id: "iphone-16-pro", w: 402, h: 874, dpr: 3, note: "iPhone 16 Pro" },
  { id: "iphone-16-pro-max", w: 440, h: 956, dpr: 3, note: "iPhone 16 Pro Max" },
  { id: "ipad-mini", w: 768, h: 1024, dpr: 2, note: "iPad mini, iPad 9.7" },
  { id: "ipad-air", w: 820, h: 1180, dpr: 2, note: "iPad Air 10.9" },
  { id: "ipad-pro-11", w: 834, h: 1194, dpr: 2, note: 'iPad Pro 11"' },
  { id: "ipad-pro-12", w: 1024, h: 1366, dpr: 2, note: 'iPad Pro 12.9"' },
];

/**
 * The splash is the icon's world, not the icon enlarged: near-black ground, one
 * localized green aura, the mark, the wordmark, and the product line. Enormous
 * negative space — the S sits above centre so the type below reads as a base.
 */
function buildSplash(
  w: number,
  h: number,
  wordmark: { d: string; width: number; capTop: number },
  tagline: { d: string; width: number },
): string {
  const short = Math.min(w, h);
  const markW = Math.round(short * 0.40);
  const markX = (w - markW) / 2;
  const markY = h / 2 - markW * 0.72;

  const wordW = short * 0.58;
  const wordScale = wordW / wordmark.width;
  const wordY = markY + markW + short * 0.10;

  const tagW = short * 0.60;
  const tagScale = tagW / tagline.width;
  const tagY = wordY + short * 0.085;

  // The aura is a disc around the mark, not a wash over the screen — §15 wants
  // it localized, and a full-canvas gradient costs 20× the bytes in a PNG that
  // is otherwise flat black.
  const auraR = Math.round(markW * 1.05);
  const auraX = Math.round(w / 2);
  const auraY = Math.round(markY + markW / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="aura" gradientUnits="userSpaceOnUse" cx="${auraX}" cy="${auraY}" r="${auraR}">
      <stop offset="0" stop-color="${BRAND.raisedGreen}" stop-opacity="0.8"/>
      <stop offset="0.5" stop-color="${BRAND.fieldGreen}" stop-opacity="0.42"/>
      <stop offset="1" stop-color="${BRAND.nearBlack}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${BRAND.nearBlack}"/>
  <circle cx="${auraX}" cy="${auraY}" r="${auraR}" fill="url(#aura)"/>
  <g transform="translate(${markX} ${markY}) scale(${markW / 1024})">${markBody()}</g>
  <g transform="translate(${(w - wordW) / 2} ${wordY}) scale(${wordScale}) translate(0 ${-wordmark.capTop})">
    <path d="${wordmark.d}" fill="${BRAND.chalk}"/>
  </g>
  <g transform="translate(${(w - tagW) / 2} ${tagY}) scale(${tagScale})">
    <path d="${tagline.d}" fill="${BRAND.gold}" fill-opacity="0.72"/>
  </g>
</svg>
`;
}

/** The transparent mark's contents, unwrapped, for embedding in the splash. */
function markBody(): string {
  return MARK_FULL.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}

/* ── Contact sheet ────────────────────────────────────────────────────────── */

function buildContactSheet(): string {
  const sizes = [300, 120, 72, 60, 40, 32];
  const cells = sizes
    .map(
      (s) => `      <figure>
        <img src="/icons/icon-1024.png" width="${s}" height="${s}" alt="The Slate S at ${s}px">
        <figcaption>${s}px</figcaption>
      </figure>`,
    )
    .join("\n");

  const row = ["icon-1024.png", "maskable-512.png"]
    .map(
      (f) =>
        `      <figure><img src="/icons/${f}" width="60" height="60" alt="${f}"><figcaption>${f.replace(".png", "")}</figcaption></figure>`,
    )
    .join("\n");

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Slate S — small-size test</title>
<style>
  :root { color-scheme: dark }
  body { margin: 0; padding: 48px 24px; background: ${BRAND.nearBlack}; color: ${BRAND.chalk};
         font: 14px/1.5 ui-sans-serif, system-ui, sans-serif }
  h1 { font-size: 15px; letter-spacing: .14em; text-transform: uppercase; color: ${BRAND.gold};
       font-weight: 600; margin: 0 0 4px }
  p { color: #8FA79B; max-width: 62ch; margin: 0 0 32px }
  section { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 32px; margin-bottom: 56px }
  figure { margin: 0; text-align: center }
  img { display: block; image-rendering: auto }
  figcaption { margin-top: 10px; font-size: 11px; letter-spacing: .08em; color: #6E8579;
               font-family: ui-monospace, monospace }
  hr { border: 0; border-top: 1px solid rgba(244,239,226,.08); margin: 0 0 40px }
</style>
<h1>Small-size test</h1>
<p>The master, downscaled by the browser exactly the way a home screen does it.
   At 60px you should read the S first, then the gold seam. Everything else is
   allowed to disappear.</p>
<section>
${cells}
</section>
<hr>
<h1>Maskable, uncropped</h1>
<p>Android crops this to a circle, a squircle, or a rounded square depending on
   the launcher. The S must clear every one of them.</p>
<section>
      <figure><img src="/icons/maskable-512.png" width="180" height="180" alt="maskable, uncropped"><figcaption>full</figcaption></figure>
      <figure><img src="/icons/maskable-512.png" width="180" height="180" style="clip-path:circle(50%)" alt="maskable, circle crop"><figcaption>circle</figcaption></figure>
      <figure><img src="/icons/maskable-512.png" width="180" height="180" style="clip-path:inset(0 round 22%)" alt="maskable, squircle crop"><figcaption>rounded</figcaption></figure>
</section>
<hr>
<h1>Home-screen row</h1>
<p>At 60px against the icons it will actually sit next to.</p>
<section>
${row}
</section>
`;
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

async function main() {
  console.log("vector masters");
  writeSvg("public/brand/slate-icon.svg", MASTER);
  writeSvg("public/brand/slate-icon-maskable.svg", MASKABLE);
  writeSvg("public/brand/slate-icon-favicon.svg", FAVICON);
  writeSvg("public/brand/slate-mark.svg", MARK);

  const wordmarkSvg = await buildWordmark();
  writeSvg("public/brand/wordmark.svg", wordmarkSvg);

  // The app's own favicon route — SVG, so it stays sharp in a tab at any DPR.
  writeSvg("src/app/icon.svg", FAVICON);

  console.log("raster icons");
  const icon1024 = writePng("public/icons/icon-1024.png", MASTER, 1024);
  writePng("public/icons/icon-512.png", MASTER, 512);
  writePng("public/icons/icon-192.png", MASTER, 192);
  writePng("public/icons/icon-180.png", MASTER, 180);
  writePng("public/icons/icon-32.png", FAVICON, 32);
  writePng("public/icons/maskable-512.png", MASKABLE, 512);
  writePng("public/icons/maskable-192.png", MASKABLE, 192);

  // Next's file conventions: these two emit their own <link> tags.
  writeFileSync(out("src/app/apple-icon.png"), png(MASTER, 180));
  console.log("  src/app/apple-icon.png");
  writeFileSync(
    out("src/app/favicon.ico"),
    buildIco([16, 32, 48].map((size) => ({ size, data: png(FAVICON, size) }))),
  );
  console.log("  src/app/favicon.ico");

  console.log("ios startup images");
  const graduate = await loadFont("graduate");
  const plex = await loadFont("plexMono");
  const word = setLine(graduate, "THE CFB SLATE", 100, 9);
  const capTop = -(graduate.tables.os2.sCapHeight ?? 700) * (100 / graduate.unitsPerEm);
  const tag = setLine(plex, "RATINGS · PREDICTIONS · PICKS · BET TRACKING", 100, 4);

  let splashBytes = 0;
  for (const d of DEVICES) {
    const w = d.w * d.dpr;
    const h = d.h * d.dpr;
    const svg = buildSplash(w, h, { d: word.d, width: word.width, capTop }, tag);
    const data = Buffer.from(new Resvg(svg).render().asPng());
    writeFileSync(out(`public/splash/${d.id}.png`), data);
    splashBytes += data.length;
  }
  console.log(`  ${DEVICES.length} files, ${(splashBytes / 1024).toFixed(0)} KB total`);

  writeFileSync(
    out("src/lib/apple-startup-images.ts"),
    `/**
 * iOS PWA startup images. GENERATED by scripts/build-brand-assets.ts — edit
 * the device table there, not here.
 *
 * Next's metadata API has no apple-touch-startup-image support, so the layout
 * renders these as <link> elements and lets React hoist them into <head>.
 * Without them iOS shows a blank white frame between the icon tap and first
 * paint, which is the one thing the brand spec says must never happen.
 */
export const APPLE_STARTUP_IMAGES: ReadonlyArray<{ href: string; media: string }> = [
${DEVICES.map(
  (d) =>
    `  // ${d.note}\n  {\n    href: "/splash/${d.id}.png",\n    media:\n      "(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)",\n  },`,
).join("\n")}
];
`,
  );
  console.log("  src/lib/apple-startup-images.ts");

  writeFileSync(out("public/brand/contact-sheet.html"), buildContactSheet());
  console.log(`  public/brand/contact-sheet.html  (master is ${(icon1024.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

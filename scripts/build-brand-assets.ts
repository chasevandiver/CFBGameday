/**
 * Cuts every brand asset from the supplied icon artwork.
 *
 *   npm run brand
 *
 * The master is `public/brand/slate-icon-source.png` — the 1254×1254 file the
 * owner supplied. **Nothing here redraws it.** Every export is a resample, a
 * crop, or a composite of those exact pixels; the only things this script draws
 * are the splash ground and the outlined wordmark that sits under the mark.
 * If the artwork changes, replace the source and re-run.
 *
 * Writes:
 *   public/brand/slate-mark.png       the mark keyed to transparency, tight crop
 *   public/brand/contact-sheet.html   the mandatory small-size test, on near-black
 *   public/icons/*.png                1024 / 512 / 192 / 180 / 32 + maskable 512 / 192
 *   public/splash/*.png               iOS startup images, portrait, per device
 *   src/app/favicon.ico               16 / 32 / 48
 *   src/app/icon.png                  32, the browser tab
 *   src/app/apple-icon.png            180, the iOS home-screen tile
 *   src/lib/apple-startup-images.ts   device table the layout renders <link>s from
 *   src/lib/brand-mark-data.ts        96px mark, base64, for the edge-rendered OG cards
 *
 * Fonts: the splash wordmark is outlined at build time from Graduate and IBM
 * Plex Mono (both OFL, fetched from Google Fonts and cached in .brand-cache/).
 * The committed PNGs carry outlines only — no font dependency ships.
 */

import { Resvg } from "@resvg/resvg-js";
import opentype from "opentype.js";
import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BRAND } from "../src/lib/brand";

const ROOT = join(import.meta.dirname, "..");
const CACHE = join(ROOT, ".brand-cache");
const SOURCE = join(ROOT, "public/brand/slate-icon-source.png");

const out = (...p: string[]) => {
  const path = join(ROOT, ...p);
  mkdirSync(join(path, ".."), { recursive: true });
  return path;
};

function report(path: string, data: Buffer) {
  writeFileSync(out(path), data);
  console.log(`  ${path}  ${(data.length / 1024).toFixed(0)} KB`);
  return data;
}

/**
 * Downscale the master. Lanczos3 — the icon is a rendered object with a hard
 * bevel and a 7px rim, and bilinear turns both to mush by 192px.
 */
function resize(input: Buffer, size: number): Promise<Buffer> {
  return sharp(input).resize(size, size, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();
}

/* ── Where the mark actually sits ─────────────────────────────────────────
   Measured off the source rather than eyeballed, so a re-supplied artwork with
   a different crop still produces correct exports. */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Flood-fill the S and its seam out of the dark field, from seeds inside the
 * letter. The plate's rim light is bright too, but it is separated from the
 * letter by dark field, so the fill never reaches it.
 *
 * Returns the mark's bounding box and a matching 8-bit mask.
 */
async function findMark(): Promise<{ box: Box; mask: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const lit = (x: number, y: number) => {
    const i = (y * W + x) * C;
    return data[i] + data[i + 1] + data[i + 2] > 110;
  };

  const mask = Buffer.alloc(W * H);
  let x0 = W;
  let y0 = H;
  let x1 = 0;
  let y1 = 0;

  // Several seeds: the seam's cast shadow cuts the letter in two for the
  // purposes of a 4-connected fill, so one seed only ever finds half of it.
  const seeds: [number, number][] = [
    [Math.round(W * 0.49), Math.round(H * 0.24)],
    [Math.round(W * 0.49), Math.round(H * 0.72)],
    [Math.round(W * 0.36), Math.round(H * 0.33)],
    [Math.round(W * 0.64), Math.round(H * 0.64)],
    [Math.round(W * 0.5), Math.round(H * 0.5)],
  ];

  for (const [sx, sy] of seeds) {
    if (mask[sy * W + sx] || !lit(sx, sy)) continue;
    const stack = [sy * W + sx];
    mask[sy * W + sx] = 255;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (mask[q] || !lit(nx, ny)) continue;
        mask[q] = 255;
        stack.push(q);
      }
    }
  }

  return { box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, mask, width: W, height: H };
}

/**
 * The mark on transparency, tight-cropped.
 *
 * The fill mask is binary, so it is blurred by under a pixel before becoming
 * the alpha channel — that is what keeps the bevel's edge from going stair-
 * stepped. Both places this is used (splash, share cards) sit on near-black,
 * which is also where the keyed edge is invisible.
 */
async function buildKeyedMark(found: Awaited<ReturnType<typeof findMark>>): Promise<Buffer> {
  const { box, mask, width, height } = found;
  const pad = 12;
  const crop = {
    left: Math.max(0, box.x - pad),
    top: Math.max(0, box.y - pad),
    width: Math.min(width, box.x + box.w + pad) - Math.max(0, box.x - pad),
    height: Math.min(height, box.y + box.h + pad) - Math.max(0, box.y - pad),
  };

  // toColourspace + raw, or sharp promotes the single-band mask to 3-band sRGB
  // on the way out and joinChannel reads a third of it as the alpha plane.
  const alpha = await sharp(mask, { raw: { width, height, channels: 1 } })
    .extract(crop)
    .blur(0.7)
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  // No ensureAlpha() first: the source is 3-band, and joinChannel appends the
  // mask as the 4th. Adding an alpha channel beforehand makes it 5-band, which
  // sharp writes out with the wrong band as alpha — the mark comes out inverted.
  return sharp(SOURCE)
    .extract(crop)
    .joinChannel(alpha, { raw: { width: crop.width, height: crop.height, channels: 1 } })
    // Palette here too: the mark is only ever composited onto near-black, and
    // 256 entries carry the chalk ramp and the gold without a visible step.
    .png({ palette: true, quality: 95, effort: 9 })
    .toBuffer();
}

/**
 * The favicon cut: the keyed mark on flat field green, nothing else.
 *
 * §30 asks for a simplified version of the same mark at 32px — keep the S and
 * the seam, drop the yard numbers and the texture, preserve contrast. Cropping
 * the artwork instead would drag the sideline rail into a 32px tile, where it
 * reads as three grey specks.
 */
async function buildFaviconTile(keyed: Buffer): Promise<Buffer> {
  const SIDE = 512;
  const mark = await sharp(keyed)
    .resize({ height: Math.round(SIDE * 0.86), kernel: "lanczos3" })
    .toBuffer();
  const { width: mw, height: mh } = await sharp(mark).metadata();
  return sharp({
    create: { width: SIDE, height: SIDE, channels: 3, background: BRAND.fieldGreen },
  })
    .composite([
      { input: mark, left: Math.round((SIDE - mw!) / 2), top: Math.round((SIDE - mh!) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

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
  archivo400: {
    url: "https://fonts.gstatic.com/s/archivo/v25/k3k6o8UDI-1M0wlSV9XAw6lQkqWY8Q82sJaRE-NWIDdgffTTNDNp8A.ttf",
    file: "Archivo-Regular.ttf",
  },
  archivo700: {
    url: "https://fonts.gstatic.com/s/archivo/v25/k3k6o8UDI-1M0wlSV9XAw6lQkqWY8Q82sJaRE-NWIDdgffTT0zRp8A.ttf",
    file: "Archivo-Bold.ttf",
  },
} as const;

/**
 * The four faces the share card renders with (BRAND.md §12: Graduate display,
 * Archivo body, Plex Mono numbers).
 *
 * These ship as files rather than as outlines, which is the opposite of what
 * the splash does — a splash draws one fixed string and can be outlined at
 * build time, while a share card sets arbitrary team names at request time and
 * needs the real font. `next/og` takes font buffers and reads no CSS, so the
 * three faces the app loads through next/font are unreachable from the route;
 * without these files the card would render in a default sans, which is exactly
 * why the three existing OG cards do.
 *
 * Only four: one weight of mono for every number, and Archivo at 400/700
 * rather than the 400/500/600/800 the mockup used in a browser. satori draws
 * tofu rather than synthesising a missing weight, and every extra face is
 * another file traced into the function.
 */
const SHARE_CARD_FONTS = ["graduate", "plexMono", "archivo400", "archivo700"] as const;

async function fontBytes(key: keyof typeof FONTS): Promise<Buffer> {
  const { url, file } = FONTS[key];
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    mkdirSync(CACHE, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${file}: ${res.status} ${res.statusText}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(path);
}

async function loadFont(key: keyof typeof FONTS): Promise<opentype.Font> {
  const bytes = await fontBytes(key);
  return opentype.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
}

/**
 * Set a line as outlines with letter-spacing. opentype's getPath has no
 * tracking, so glyphs are advanced by hand — which is what the wordmark needs
 * anyway: display caps at this size want air between them.
 */
function setLine(font: opentype.Font, text: string, fontSize: number, tracking: number) {
  const scale = fontSize / font.unitsPerEm;
  const path = new opentype.Path();
  let x = 0;
  // charToGlyph, not stringToGlyphs: the latter runs opentype's shaper, which
  // throws on lookups these fonts happen to carry. Caps and digits need none.
  const glyphs = [...text].map((ch) => font.charToGlyph(ch));
  glyphs.forEach((glyph, i) => {
    path.extend(glyph.getPath(x, 0, fontSize));
    x += glyph.advanceWidth! * scale;
    if (i < glyphs.length - 1) x += tracking;
  });
  return { d: path.toPathData(2), width: x };
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
 * Devices to cut a startup image for.
 *
 * `w`/`h` are the device's **portrait** dimensions and stay that way in both
 * orientations — iOS reports `device-width`/`device-height` as the natural size
 * regardless of how the thing is being held, so only `orientation` varies in
 * the query while the image itself swaps.
 *
 * iPads get both orientations. An earlier version shipped portrait only, on the
 * reasoning that a cold launch to landscape is rare; that was wrong, and the
 * failure is loud rather than absent — when nothing matches, iOS stretches
 * whatever it has to fill the screen. iPhones stay portrait-only because iOS
 * genuinely ignores landscape startup images on them.
 *
 * The sizes matter more than they look. A current iPad mini is 744×1133, not
 * the 768×1024 of the 9.7" and the mini 5, and the M4 Pros are 834×1210 and
 * 1032×1376 rather than the 1194/1366 of their predecessors. Miss one and that
 * device matches nothing at all.
 */
const DEVICES: ReadonlyArray<{
  id: string;
  w: number;
  h: number;
  dpr: number;
  note: string;
  /** iPad: cut portrait and landscape. iPhone: portrait only. */
  both?: boolean;
}> = [
  { id: "iphone-xr", w: 414, h: 896, dpr: 2, note: "iPhone 11, XR" },
  { id: "iphone-x", w: 375, h: 812, dpr: 3, note: "iPhone 11 Pro, 12 mini, 13 mini, X, XS" },
  { id: "iphone-xs-max", w: 414, h: 896, dpr: 3, note: "iPhone 11 Pro Max, XS Max" },
  { id: "iphone-12", w: 390, h: 844, dpr: 3, note: "iPhone 12, 13, 14" },
  { id: "iphone-12-pro-max", w: 428, h: 926, dpr: 3, note: "iPhone 12/13 Pro Max, 14 Plus" },
  { id: "iphone-14-pro", w: 393, h: 852, dpr: 3, note: "iPhone 14 Pro, 15, 15 Pro, 16" },
  { id: "iphone-14-pro-max", w: 430, h: 932, dpr: 3, note: "iPhone 14/15 Pro Max, 15 Plus, 16 Plus" },
  { id: "iphone-16-pro", w: 402, h: 874, dpr: 3, note: "iPhone 16 Pro" },
  { id: "iphone-16-pro-max", w: 440, h: 956, dpr: 3, note: "iPhone 16 Pro Max" },
  { id: "ipad-97", w: 768, h: 1024, dpr: 2, note: 'iPad 9.7", iPad mini 4/5', both: true },
  { id: "ipad-102", w: 810, h: 1080, dpr: 2, note: 'iPad 7th–9th gen 10.2"', both: true },
  { id: "ipad-105", w: 834, h: 1112, dpr: 2, note: 'iPad Pro 10.5", iPad Air 3', both: true },
  { id: "ipad-mini-6", w: 744, h: 1133, dpr: 2, note: "iPad mini 6, mini 7", both: true },
  { id: "ipad-109", w: 820, h: 1180, dpr: 2, note: 'iPad Air 10.9", iPad 10th/11th gen', both: true },
  { id: "ipad-pro-11", w: 834, h: 1194, dpr: 2, note: 'iPad Pro 11" 1st–4th gen', both: true },
  { id: "ipad-pro-11-m4", w: 834, h: 1210, dpr: 2, note: 'iPad Pro 11" M4, Air 11" M2', both: true },
  { id: "ipad-pro-129", w: 1024, h: 1366, dpr: 2, note: 'iPad Pro 12.9", Air 13" M2', both: true },
  { id: "ipad-pro-13-m4", w: 1032, h: 1376, dpr: 2, note: 'iPad Pro 13" M4', both: true },
];

/** One image to cut: a device in one orientation. */
interface SplashTarget {
  id: string;
  href: string;
  /** Every media rule that should resolve to this image. iPad landscape needs
   *  two — see the note in splashTargets. */
  medias: string[];
  pxW: number;
  pxH: number;
  note: string;
}

function splashTargets(): SplashTarget[] {
  const out: SplashTarget[] = [];
  for (const d of DEVICES) {
    const orientations: ("portrait" | "landscape")[] = d.both
      ? ["portrait", "landscape"]
      : ["portrait"];
    for (const orientation of orientations) {
      const landscape = orientation === "landscape";
      const id = landscape ? `${d.id}-landscape` : d.id;
      /* Owner report, 2026-08-21: the iPad landscape splash opens "very
         stretched out" — the signature of a PORTRAIT image scaled to fill a
         landscape screen, i.e. no landscape rule matched and iOS fell back.
         The files themselves are correct (ipad-pro-129-landscape.png really is
         2732×2048), so the miss is in the query.
         The convention every generator emits is portrait `device-width` /
         `device-height` plus `orientation: landscape`, on the assumption that
         those two features report the physical screen and never rotate. That
         holds on iPhone. On iPad it evidently does not, which is exactly the
         class of thing no amount of reading the markup would have found and a
         tap on a real device found in a second.
         So each landscape target emits BOTH orders. Whichever way the device
         reports its dimensions, one rule matches, and both name the same file —
         a device that matches both gets the same image twice, which is a
         no-op rather than a conflict. */
      const dims = landscape
        ? [
            { w: d.w, h: d.h },
            { w: d.h, h: d.w },
          ]
        : [{ w: d.w, h: d.h }];
      out.push({
        id,
        href: `/splash/${id}.png`,
        // One image, one or two rules — the image is rendered once and the
        // link table lists every rule that should resolve to it.
        medias: dims.map(
          (dim) =>
            `(device-width: ${dim.w}px) and (device-height: ${dim.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: ${orientation})`,
        ),
        pxW: (landscape ? d.h : d.w) * d.dpr,
        pxH: (landscape ? d.w : d.h) * d.dpr,
        note: `${d.note}${landscape ? " (landscape)" : ""}`,
      });
    }
  }
  return out;
}

/**
 * The splash extends the icon's world rather than enlarging the icon (§23): the
 * mark itself on near-black, one localized green aura behind it, the wordmark
 * and the product line below, and a great deal of nothing.
 */
function buildSplash(
  markDataUri: string,
  markAspect: number,
  w: number,
  h: number,
  wordmark: { d: string; width: number; capTop: number },
  tagline: { d: string; width: number; capTop: number },
): string {
  const short = Math.min(w, h);
  const markH = Math.round(short * 0.34);
  const markW = Math.round(markH * markAspect);
  const markX = (w - markW) / 2;
  const markY = h / 2 - markH * 0.78;

  const wordW = short * 0.58;
  const wordScale = wordW / wordmark.width;
  // `wordY` is where the wordmark's CAP TOP lands: the group below compensates
  // for capTop, so the ink runs from here down by its rendered cap height.
  const wordY = markY + markH + short * 0.1;
  const wordCapH = Math.abs(wordmark.capTop) * wordScale;

  const tagW = short * 0.6;
  const tagScale = tagW / tagline.width;
  const tagCapH = Math.abs(tagline.capTop) * tagScale;
  /* Owner report, 2026-08-21: "the text under The Slate is right below it so it
     looks pretty smushed together."
     The gap used to be `wordY + short * 0.09` — a distance from the wordmark's
     cap top to the tagline's BASELINE, which is not a gap between anything a
     reader can see. Two rendered heights were hiding inside it (the wordmark's
     caps, ~6.2% of the short side, and the tagline's, ~1.5%), so what was left
     between the two blocks of ink was about 1.3% — and it shrank further on any
     device where the wordmark set wider.
     Now it is what it says: the wordmark's baseline, a deliberate gap, then the
     tagline's cap top. Both terms are measured from the outlined glyphs rather
     than assumed, so a font change moves the type instead of quietly closing
     the gap. */
  const SPLASH_GAP = 0.055;
  const tagY = wordY + wordCapH + short * SPLASH_GAP + tagCapH;

  // A disc around the mark, not a wash over the screen — §15 wants the aura
  // localized, and a full-canvas gradient costs 20× the bytes in a PNG that is
  // otherwise flat black.
  const auraR = Math.round(markH * 1.05);
  const auraX = Math.round(w / 2);
  const auraY = Math.round(markY + markH / 2);

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
  <image href="${markDataUri}" x="${markX}" y="${markY}" width="${markW}" height="${markH}"/>
  <g transform="translate(${(w - wordW) / 2} ${wordY}) scale(${wordScale}) translate(0 ${-wordmark.capTop})">
    <path d="${wordmark.d}" fill="${BRAND.chalk}"/>
  </g>
  <g transform="translate(${(w - tagW) / 2} ${tagY}) scale(${tagScale})">
    <path d="${tagline.d}" fill="${BRAND.gold}" fill-opacity="0.72"/>
  </g>
</svg>
`;
}

/* ── Contact sheet ────────────────────────────────────────────────────────── */

function buildContactSheet(): string {
  const cells = [300, 120, 72, 60, 40, 32]
    .map(
      (s) => `      <figure>
        <img src="/brand/slate-icon-source.png" width="${s}" height="${s}" alt="The Slate S at ${s}px">
        <figcaption>${s}px</figcaption>
      </figure>`,
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
  img { display: block }
  figcaption { margin-top: 10px; font-size: 11px; letter-spacing: .08em; color: #6E8579;
               font-family: ui-monospace, monospace }
  hr { border: 0; border-top: 1px solid rgba(244,239,226,.08); margin: 0 0 40px }
</style>
<h1>Small-size test</h1>
<p>The supplied artwork, downscaled by the browser exactly the way a home screen
   does it. At 60px you should read the S first, then the gold seam. Everything
   else is allowed to disappear.</p>
<section>
${cells}
</section>
<hr>
<h1>Maskable, uncropped</h1>
<p>Android crops this to a circle, a squircle, or a rounded square depending on
   the launcher. The S must clear every one of them — it sits at 0.37 of the
   canvas from centre, inside the 0.40 safe radius, so it does.</p>
<section>
      <figure><img src="/icons/maskable-512.png" width="180" height="180" alt="maskable, uncropped"><figcaption>full</figcaption></figure>
      <figure><img src="/icons/maskable-512.png" width="180" height="180" style="clip-path:circle(50%)" alt="maskable, circle crop"><figcaption>circle</figcaption></figure>
      <figure><img src="/icons/maskable-512.png" width="180" height="180" style="clip-path:inset(0 round 22%)" alt="maskable, squircle crop"><figcaption>rounded</figcaption></figure>
</section>
<hr>
<h1>Favicon cut</h1>
<p>At 32px the panel, the rim and the yard numbers are noise, so the tab icon is
   cropped to the mark alone (§30).</p>
<section>
      <figure><img src="/icons/icon-32.png" width="128" height="128" style="image-rendering:pixelated" alt="favicon at 4×"><figcaption>32px at 4×</figcaption></figure>
      <figure><img src="/icons/icon-32.png" width="32" height="32" alt="favicon"><figcaption>32px</figcaption></figure>
      <figure><img src="/icons/icon-192.png" width="60" height="60" alt="full icon at 60px"><figcaption>full icon, 60px</figcaption></figure>
</section>
`;
}

/**
 * Diagnostic: which startup-image query matches the device you are holding.
 *
 * `apple-touch-startup-image` fails silently and confusingly — an unmatched
 * query does not give you a plain frame, it gives you a stretched one, and from
 * the device there is no way to tell which. This evaluates every query with
 * `matchMedia` and prints the device's own numbers, so a missing size is a fact
 * rather than a hypothesis.
 */
function buildSplashCheck(
  entries: { href: string; media: string; note: string }[],
): string {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Splash check</title>
<style>
  body { margin:0; padding:24px; background:${BRAND.nearBlack}; color:${BRAND.chalk};
         font:14px/1.5 ui-sans-serif, system-ui, sans-serif }
  h1 { font-size:15px; letter-spacing:.14em; text-transform:uppercase; color:${BRAND.gold}; margin:0 0 12px }
  .big { font-family:ui-monospace,monospace; font-size:20px; color:${BRAND.gold}; margin:12px 0 }
  table { border-collapse:collapse; width:100%; font-size:11px; font-family:ui-monospace,monospace }
  td { padding:4px 6px; border-top:1px solid rgba(244,239,226,.1); vertical-align:top }
  .yes { color:#35a46f; font-weight:700 }
  .no  { color:#6E8579 }
  p { color:#8FA79B; max-width:70ch }
</style>
<h1>Startup image check</h1>
<p>Open this on the device with the problem, in the orientation with the problem.
   If <b>no</b> row says MATCH, iOS has nothing to show and stretches a fallback —
   that is the bug, and the numbers below are what the device table is missing.</p>
<div class="big" id="dev"></div>
<table id="rows"></table>
<script>
  var entries = ${JSON.stringify(entries)};
  var o = (window.screen.orientation && window.screen.orientation.type) || "unknown";
  document.getElementById("dev").textContent =
    "screen " + screen.width + "x" + screen.height +
    " · dpr " + window.devicePixelRatio +
    " · " + (window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait") +
    " (" + o + ")";
  var html = "", hits = 0;
  entries.forEach(function (e) {
    var m = window.matchMedia(e.media).matches;
    if (m) hits++;
    html += "<tr><td class=" + (m ? "yes>MATCH" : "no>—") + "</td><td>" + e.note +
            "</td><td class=no>" + e.media.replace(/ and /g, "<br>and ") + "</td></tr>";
  });
  document.getElementById("rows").innerHTML =
    "<tr><td colspan=3 class=" + (hits ? "yes" : "no") + ">" + hits +
    " of " + entries.length + " matched</td></tr>" + html;
</script>
`;
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

async function main() {
  if (!existsSync(SOURCE)) throw new Error(`missing artwork: ${SOURCE}`);
  const source = readFileSync(SOURCE);
  const meta = await sharp(source).metadata();
  console.log(`source ${meta.width}×${meta.height}, alpha=${meta.hasAlpha}`);

  const found = await findMark();
  const c = (found.width - 1) / 2;
  const reach =
    Math.max(
      ...[
        [found.box.x, found.box.y],
        [found.box.x + found.box.w, found.box.y],
        [found.box.x, found.box.y + found.box.h],
        [found.box.x + found.box.w, found.box.y + found.box.h],
      ].map(([x, y]) => Math.hypot(x - c, y - c)),
    ) / found.width;
  console.log(`mark reaches ${reach.toFixed(3)} of the canvas from centre (maskable safe: 0.400)`);

  console.log("mark");
  const keyed = report("public/brand/slate-mark.png", await buildKeyedMark(found));

  const keyedMeta = await sharp(keyed).metadata();
  const markAspect = keyedMeta.width! / keyedMeta.height!;
  const favSource = await buildFaviconTile(keyed);

  console.log("icons");
  // No separate 1024 export: the committed source is 1254² and is listed in the
  // manifest as the large icon. Re-encoding it at 1024 would add 1.2 MB of
  // near-identical pixels to the repo for nothing.
  for (const size of [512, 192, 180]) {
    report(`public/icons/icon-${size}.png`, await resize(source, size));
  }
  // The mark already clears the 80% safe circle, so the maskable is the same
  // artwork — no second crop, no second composition to drift out of sync.
  for (const size of [512, 192]) {
    report(`public/icons/maskable-${size}.png`, await resize(source, size));
  }

  report("public/icons/icon-32.png", await resize(favSource, 32));

  console.log("app routes");
  report("src/app/apple-icon.png", await resize(source, 180));
  report("src/app/icon.png", await resize(favSource, 32));
  report(
    "src/app/favicon.ico",
    buildIco(
      await Promise.all(
        [16, 32, 48].map(async (size) => ({ size, data: await resize(favSource, size) })),
      ),
    ),
  );

  // Inlined for the OG cards: they render on the edge, and a share card that
  // has to reach the network to draw its own logo is one that sometimes ships
  // without one.
  const stamp = await sharp(keyed).resize({ height: 192, kernel: "lanczos3" }).png().toBuffer();
  writeFileSync(
    out("src/lib/brand-mark-data.ts"),
    `/**
 * The Slate S, keyed to transparency and inlined as a data URI.
 * GENERATED by scripts/build-brand-assets.ts from public/brand/slate-icon-source.png.
 *
 * Used by the OG image routes, which run on the edge and cannot read from disk.
 */
export const SLATE_MARK_DATA_URI =
  "data:image/png;base64,${stamp.toString("base64")}";

/** Width ÷ height of the image above, for laying it out without a fetch. */
export const SLATE_MARK_ASPECT = ${(markAspect).toFixed(4)};
`,
  );
  console.log(`  src/lib/brand-mark-data.ts  ${(stamp.length / 1024).toFixed(0)} KB inlined`);

  // The share card sets arbitrary team names at request time, so it needs the
  // real fonts rather than the outlines the splash gets. next/og reads buffers,
  // not CSS, so next/font is unreachable from a route handler.
  console.log("share-card fonts");
  for (const key of SHARE_CARD_FONTS) {
    report(`public/fonts/${FONTS[key].file}`, await fontBytes(key));
  }

  console.log("ios startup images");
  const graduate = await loadFont("graduate");
  const plex = await loadFont("plexMono");
  const word = setLine(graduate, "THE SLATE", 100, 9);
  const capTop = -(graduate.tables.os2.sCapHeight ?? 700) * (100 / graduate.unitsPerEm);
  const tag = setLine(plex, "RATINGS · PREDICTIONS · PICKS · BET TRACKING", 100, 4);
  // The tagline is drawn from its baseline, so the splash needs its cap height
  // to leave a real gap above it rather than one measured to nothing.
  const tagCapTop = -(plex.tables.os2.sCapHeight ?? 700) * (100 / plex.unitsPerEm);
  const markUri = `data:image/png;base64,${keyed.toString("base64")}`;

  const targets = splashTargets();
  let bytes = 0;
  for (const t of targets) {
    const svg = buildSplash(
      markUri,
      markAspect,
      t.pxW,
      t.pxH,
      { d: word.d, width: word.width, capTop },
      { ...tag, capTop: tagCapTop },
    );
    // Palette-quantised: a splash is one dark ground, one aura and two colours
    // of type. 256 entries hold all of it, and it keeps the set under a couple
    // of megabytes now that iPads need both orientations.
    const data = await sharp(Buffer.from(new Resvg(svg).render().asPng()))
      .png({ palette: true, quality: 92, effort: 9 })
      .toBuffer();
    writeFileSync(out(`public/splash/${t.id}.png`), data);
    bytes += data.length;
  }
  console.log(
    `  ${targets.length} files, ${(bytes / 1024).toFixed(0)} KB total, ` +
      `${targets.reduce((n, t) => n + t.medias.length, 0)} media rules`,
  );

  writeFileSync(
    out("src/lib/apple-startup-images.ts"),
    `/**
 * iOS PWA startup images. GENERATED by scripts/build-brand-assets.ts — edit the
 * device table there, not here.
 *
 * Next's metadata API has no apple-touch-startup-image field, so the layout
 * renders these as <link> elements and lets React hoist them into <head>.
 * Without them iOS shows a blank white frame between the icon tap and first
 * paint, which is the one thing the brand spec says must never happen.
 */
export const APPLE_STARTUP_IMAGES: ReadonlyArray<{ href: string; media: string }> = [
${targets
  .flatMap((t) =>
    t.medias.map(
      (media) => `  // ${t.note}\n  {\n    href: "${t.href}",\n    media:\n      "${media}",\n  },`,
    ),
  )
  .join("\n")}
];
`,
  );
  console.log("  src/lib/apple-startup-images.ts");

  // Guessing at the device table has now been wrong twice. This reports what a
  // real handset actually says, so the next fix is measured rather than
  // inferred: open /brand/splash-check.html on the device in question.
  writeFileSync(
    out("public/brand/splash-check.html"),
    buildSplashCheck(
      targets.flatMap((t) => t.medias.map((media) => ({ href: t.href, media, note: t.note }))),
    ),
  );
  console.log("  public/brand/splash-check.html");

  writeFileSync(out("public/brand/contact-sheet.html"), buildContactSheet());
  console.log("  public/brand/contact-sheet.html");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

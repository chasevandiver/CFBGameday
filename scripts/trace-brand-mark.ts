/**
 * Traces a flat vector mark out of the supplied icon artwork.
 *
 *   npx tsx scripts/trace-brand-mark.ts
 *
 * Writes `src/lib/brand-mark-outline.ts`: two path strings, the letter and the
 * football seam, in a viewBox cropped to the mark.
 *
 * This is a trace, not a redraw. Every vertex comes off the boundary of the
 * owner's pixels in `public/brand/slate-icon-source.png`, so the letterform,
 * the counters, the chamfers and the seam are exact. What it cannot carry is
 * the bevel, the chalk grain and the rim light — a trace is a silhouette. That
 * is the right thing for the places it is used (nav at 22px, share-card stamps,
 * anywhere the mark has to take a theme colour) and it is NOT a replacement for
 * a layered vector master; the raster stays the master for the icon itself.
 *
 * Verify a change by eye: render both paths in a translucent colour on top of
 * the source at full size. The letter should disappear into the S exactly, edge
 * for edge, and the seam should cover the blade and all six laces.
 */

import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SOURCE = join(ROOT, "public/brand/slate-icon-source.png");

type Pt = [number, number];

/** Douglas–Peucker. Straightens the pixel staircase into the letter's real edges. */
function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;
  let worst = 0;
  let index = 0;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= epsilon) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, index + 1), epsilon).slice(0, -1),
    ...simplify(points.slice(index), epsilon),
  ];
}

/**
 * Walk the boundary between set and unset pixels.
 *
 * Each filled pixel contributes a directed edge for every side facing a hole,
 * wound so the interior is always on the same hand. Chaining those edges yields
 * every closed loop — outer contours and counters alike — which is what lets
 * one pass produce an S with two bowls in it.
 */
function traceLoops(mask: Uint8Array, W: number, H: number): Pt[][] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  const edges = new Map<number, Pt[]>();
  const key = (x: number, y: number) => y * (W + 1) + x;
  const push = (a: Pt, b: Pt) => {
    const k = key(a[0], a[1]);
    const arr = edges.get(k);
    if (arr) arr.push(b);
    else edges.set(k, [b]);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) push([x, y], [x + 1, y]);
      if (!on(x + 1, y)) push([x + 1, y], [x + 1, y + 1]);
      if (!on(x, y + 1)) push([x + 1, y + 1], [x, y + 1]);
      if (!on(x - 1, y)) push([x, y + 1], [x, y]);
    }
  }

  const loops: Pt[][] = [];
  while (edges.size) {
    const startKey: number = edges.keys().next().value!;
    const sx = startKey % (W + 1);
    const sy = (startKey - sx) / (W + 1);
    const loop: Pt[] = [];
    let cur: Pt = [sx, sy];
    for (;;) {
      const arr = edges.get(key(cur[0], cur[1]));
      if (!arr?.length) break;
      const next = arr.pop()!;
      if (!arr.length) edges.delete(key(cur[0], cur[1]));
      loop.push(cur);
      cur = next;
      if (cur[0] === sx && cur[1] === sy) break;
    }
    // Sub-pixel specks: keeping them would put invisible noise in the path data.
    if (loop.length > 24) loops.push(loop);
  }
  return loops;
}

/** Signed area — used to drop loops too small to matter at any rendered size. */
function area(loop: Pt[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % loop.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function toPath(loops: Pt[][], ox: number, oy: number, scale: number, eps: number): string {
  return loops
    .map((loop) => simplify(loop, eps))
    .map(
      (loop) =>
        `M${loop
          .map(([x, y]) => `${round((x - ox) * scale)} ${round((y - oy) * scale)}`)
          .join("L")}Z`,
    )
    .join("");
}

const round = (n: number) => Math.round(n * 10) / 10;

async function main() {
  const { data, info } = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const rgb = (x: number, y: number) => {
    const i = (y * W + x) * C;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };

  // 1. The lit object: the letter and its seam, flood-filled off the dark field.
  //    The panel's rim light is bright too but is separated from the letter by
  //    field, so the fill never reaches it. Several seeds — the seam's cast
  //    shadow splits the letter in two for a 4-connected fill.
  const object = new Uint8Array(W * H);
  const lit = (x: number, y: number) => {
    const [r, g, b] = rgb(x, y);
    return r + g + b > 110;
  };
  for (const [fx, fy] of [
    [0.49, 0.24],
    [0.49, 0.72],
    [0.36, 0.33],
    [0.64, 0.64],
  ]) {
    const sx = Math.round(W * fx);
    const sy = Math.round(H * fy);
    if (object[sy * W + sx] || !lit(sx, sy)) continue;
    const stack = [sy * W + sx];
    object[sy * W + sx] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
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
        if (object[q] || !lit(nx, ny)) continue;
        object[q] = 1;
        stack.push(q);
      }
    }
  }

  // 2. Seal the letter. The seam's cast shadow is dark enough to fall out of
  //    the flood fill, which leaves a slot through the waist; closing it gives
  //    the solid letterform the flat mark needs.
  const letter = closeMask(object, W, H, 10);

  // 3. Gold: warm, and red well clear of blue. Deliberately loose — a
  //    saturation cut tight enough to exclude the chalk also drops the lit tops
  //    of the laces, which is how an earlier pass ended up tracing the blade's
  //    darkest edge and nothing else. Restricted to the letter, so the panel's
  //    gold rim never enters the picture.
  const gold = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * C];
    const g = data[i * C + 1];
    const b = data[i * C + 2];
    if (r > 90 && r - b > 55 && r >= g && g > b) gold[i] = 1;
  }

  // 4. Of the gold regions, the seam is the one that crosses the letter:
  //    its box spans nearly the full width and straddles the vertical centre.
  //    The extrude does not — it sits along the bottom edge, around a counter,
  //    or in the notch, and every one of those fails one of the two tests.
  const seam = new Uint8Array(W * H);
  const seen = new Uint8Array(W * H);
  const bounds = objectBounds(object, W, H);
  const midY = bounds.y + bounds.h / 2;
  for (let i = 0; i < W * H; i++) {
    if (!gold[i] || seen[i]) continue;
    const cells: number[] = [];
    const stack = [i];
    seen[i] = 1;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      cells.push(p);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (seen[q] || !gold[q]) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const inside =
      x0 >= bounds.x && y0 >= bounds.y && x1 <= bounds.x + bounds.w && y1 <= bounds.y + bounds.h;
    const spansWidth = (x1 - x0) / bounds.w > 0.7;
    const straddlesMiddle = y0 < midY && y1 > midY;
    if (inside && spansWidth && straddlesMiddle) for (const p of cells) seam[p] = 1;
  }

  const box = objectBounds(object, W, H);
  const pad = 2;
  const ox = box.x - pad;
  const oy = box.y - pad;
  const vw = box.w + pad * 2;
  const vh = box.h + pad * 2;

  const keep = (loops: Pt[][], min: number) => loops.filter((l) => area(l) > min);
  const letterPath = toPath(keep(traceLoops(letter, W, H), 400), ox, oy, 1, 1.1);
  const seamPath = toPath(keep(traceLoops(seam, W, H), 120), ox, oy, 1, 0.9);

  writeFileSync(
    join(ROOT, "src/lib/brand-mark-outline.ts"),
    `/**
 * The Slate S as flat outlines. GENERATED by scripts/trace-brand-mark.ts —
 * traced off public/brand/slate-icon-source.png, never drawn by hand.
 *
 * Two paths on a ${vw}×${vh} grid: the letter and the football seam. Both are
 * silhouettes; the bevel, the chalk grain and the rim light live only in the
 * raster. Use this where the mark has to be small, crisp, or a theme colour —
 * the nav, share-card stamps, anything inline. Use the raster for tiles.
 *
 * To regenerate after replacing the artwork: npx tsx scripts/trace-brand-mark.ts
 */

/** viewBox for both paths below. */
export const MARK_VIEWBOX = "0 0 ${vw} ${vh}";

/** Width ÷ height of that box, for reserving space without a measure. */
export const MARK_ASPECT = ${(vw / vh).toFixed(4)};

/** The letter, counters included. Fill it with the ink colour. */
export const MARK_LETTER_PATH =
  "${letterPath}";

/** The football seam and its laces. Fill it with the accent. */
export const MARK_SEAM_PATH =
  "${seamPath}";
`,
  );

  console.log(`viewBox 0 0 ${vw} ${vh}`);
  console.log(`letter ${letterPath.length} chars, seam ${seamPath.length} chars`);
}

function objectBounds(mask: Uint8Array, W: number, H: number) {
  let x0 = W;
  let y0 = H;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Morphological close with a square kernel, done separably — dilate then erode,
 * each as a horizontal pass followed by a vertical one. The naive version is
 * O(W·H·r²) and takes minutes on a 1254² mask; this is O(W·H·r).
 */
function closeMask(mask: Uint8Array, W: number, H: number, r: number): Uint8Array {
  return pass(pass(mask, W, H, r, true), W, H, r, false);
}

function pass(mask: Uint8Array, W: number, H: number, r: number, dilate: boolean): Uint8Array {
  const mid = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  // Outside the frame counts as empty when dilating and as filled when eroding,
  // so a shape touching the edge is not eaten away by its own border.
  const edge = dilate ? 0 : 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = edge;
      for (let k = -r; k <= r; k++) {
        const nx = x + k;
        const s = nx < 0 || nx >= W ? edge : mask[y * W + nx];
        v = dilate ? v | s : v & s;
      }
      mid[y * W + x] = v;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = edge;
      for (let k = -r; k <= r; k++) {
        const ny = y + k;
        const s = ny < 0 || ny >= H ? edge : mid[ny * W + x];
        v = dilate ? v | s : v & s;
      }
      out[y * W + x] = v;
    }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

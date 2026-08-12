import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { BRAND } from "../src/lib/brand";

/**
 * Guards on the shipped icon files, not on how they look — taste is not
 * testable, but these are, and each is a Definition-of-Done line that would
 * otherwise only fail on someone's phone after they install the app.
 *
 * The artwork itself is supplied, not generated (public/brand/slate-icon-source.png).
 * What these check is that it is fit for the surfaces it is being used on, and
 * that every export the manifest and the layout reference actually exists.
 */

const ROOT = join(import.meta.dirname, "..");
const SOURCE = join(ROOT, "public/brand/slate-icon-source.png");

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

async function pixels(path: string) {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: info.channels > 3 ? data[i + 3] : 255 };
  };
  return { data, info, at };
}

describe("the supplied icon artwork", () => {
  it("is a square, fully opaque image", async () => {
    // iOS composites the touch icon over white. One transparent pixel and the
    // tile grows a bright fringe on the home screen.
    const meta = await sharp(SOURCE).metadata();
    expect(meta.width).toBe(meta.height);
    expect(meta.hasAlpha).toBe(false);
  });

  it("keeps its own corners square", async () => {
    // The rounded panel inside the artwork is a drawing. The icon itself has to
    // stay a painted square: the OS rounds the tile, and a second rounding here
    // gives the double corner that reads as homemade.
    const { info, at } = await pixels(SOURCE);
    for (const [x, y] of [
      [0, 0],
      [info.width - 1, 0],
      [0, info.height - 1],
      [info.width - 1, info.height - 1],
    ]) {
      const p = at(x, y);
      expect(p.a).toBe(255);
      // Near-black ground, not a cut-out and not a stray light colour.
      expect(p.r + p.g + p.b).toBeLessThan(24);
    }
  });

  it("keeps the whole mark inside the Android maskable safe circle", async () => {
    // 80% safe area = a circle of radius 0.40×size about the centre. The same
    // artwork serves the maskable exports, so if the letter ever moves outward
    // a round launcher starts clipping it.
    const { info, at } = await pixels(SOURCE);
    const lit = (x: number, y: number) => {
      const p = at(x, y);
      return p.r + p.g + p.b > 110;
    };

    // Flood the letter out of the dark field. The panel's rim light is bright
    // too but is separated from the letter by field, so the fill never reaches
    // it. Several seeds: the seam's cast shadow splits the letter in two for a
    // 4-connected fill.
    const { width: W, height: H } = info;
    const seen = new Uint8Array(W * H);
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    for (const [fx, fy] of [
      [0.49, 0.24],
      [0.49, 0.72],
      [0.36, 0.33],
      [0.64, 0.64],
    ]) {
      const sx = Math.round(W * fx);
      const sy = Math.round(H * fy);
      if (seen[sy * W + sx] || !lit(sx, sy)) continue;
      const stack = [sy * W + sx];
      seen[sy * W + sx] = 1;
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
          if (seen[q] || !lit(nx, ny)) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
    }

    const c = (W - 1) / 2;
    const reach =
      Math.max(
        ...[
          [x0, y0],
          [x1, y0],
          [x0, y1],
          [x1, y1],
        ].map(([x, y]) => Math.hypot(x - c, y - c)),
      ) / W;
    expect(reach).toBeLessThan(0.4);
  });
});

describe("the exports", () => {
  const required = [
    "public/icons/icon-512.png",
    "public/icons/icon-192.png",
    "public/icons/icon-180.png",
    "public/icons/icon-32.png",
    "public/icons/maskable-512.png",
    "public/icons/maskable-192.png",
    "public/brand/slate-mark.png",
    "src/app/apple-icon.png",
    "src/app/icon.png",
    "src/app/favicon.ico",
  ];

  it.each(required)("%s exists", (rel) => {
    expect(existsSync(join(ROOT, rel))).toBe(true);
  });

  it.each(["public/icons/icon-512.png", "public/icons/maskable-512.png", "src/app/apple-icon.png"])(
    "%s is opaque at every pixel",
    async (rel) => {
      const { data, info } = await sharp(join(ROOT, rel)).ensureAlpha().raw().toBuffer({
        resolveWithObject: true,
      });
      let transparent = 0;
      for (let i = 3; i < data.length; i += info.channels) if (data[i] !== 255) transparent++;
      expect(transparent).toBe(0);
    },
  );

  it("keys the mark to transparency without eating the letter", async () => {
    // The splash and both share cards composite this over near-black. If the
    // fill inverts — which it did once, when sharp promoted the single-band
    // mask to sRGB — the letter vanishes and the counters go solid.
    const { info, at } = await pixels(join(ROOT, "public/brand/slate-mark.png"));
    expect(info.channels).toBe(4);
    expect(at(1, 1).a).toBe(0); // corner, outside the letter
    expect(at(Math.round(info.width * 0.5), Math.round(info.height * 0.12)).a).toBe(255); // top arm
    expect(at(Math.round(info.width * 0.55), Math.round(info.height * 0.22)).a).toBe(0); // bowl
  });

  it("gives the favicon a ground of its own", async () => {
    // At 32px the panel, the rim and the yard numbers are noise, so the tab cut
    // is the mark on flat field green (§30). A transparent favicon would land
    // on whatever the browser's tab strip happens to be.
    const { info, at } = await pixels(join(ROOT, "public/icons/icon-32.png"));
    expect(info.width).toBe(32);
    expect(hex(at(1, 1).r, at(1, 1).g, at(1, 1).b)).toBe(BRAND.fieldGreen.toLowerCase());
  });

  it("inlines a mark small enough to ship inside an edge function", async () => {
    const src = readFileSync(join(ROOT, "src/lib/brand-mark-data.ts"), "utf8");
    expect(src).toContain("data:image/png;base64,");
    // Cloudflare's limit is 1 MB compressed; this is the whole card's budget.
    expect(src.length).toBeLessThan(80_000);
  });
});

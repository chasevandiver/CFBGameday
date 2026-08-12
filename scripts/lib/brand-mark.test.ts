import { describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import { MARK_CANVAS, SEAM_LACES, S_PATH } from "../../src/lib/brand";
import { buildMark } from "./brand-mark";

/**
 * Guards on the icon, not on how it looks — taste is not testable, but these
 * four properties are, and every one of them is a Definition-of-Done line that
 * would otherwise only fail on someone's phone after install.
 */

/** Every vertex of the S, as distances from the canvas centre. */
function sVertexRadii(): number[] {
  const c = MARK_CANVAS / 2;
  return [...S_PATH.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) =>
    Math.hypot(Number(x) - c, Number(y) - c),
  );
}

/** RGBA pixels of the master, rendered small enough to scan cheaply. */
function renderPixels(svg: string, width: number) {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render();
  return { data: img.pixels, width: img.width, height: img.height };
}

describe("the Slate S", () => {
  it("keeps the whole letter inside the Android maskable safe circle", () => {
    // 80% safe area on a 1024 grid: a circle of radius 409.6 about the centre.
    // The maskable export scales the foreground to 0.94; if someone widens the
    // letter without re-checking this, round launchers clip it.
    const safe = MARK_CANVAS * 0.4;
    const worst = Math.max(...sVertexRadii()) * 0.94;
    expect(worst).toBeLessThan(safe);
  });

  it("keeps the seam laces on the seam", () => {
    // A lace that drifts off the crescent reads as a gold speck, which at 60px
    // is indistinguishable from dirt on the screen.
    for (const [x, y] of SEAM_LACES) {
      expect(x).toBeGreaterThan(400);
      expect(x).toBeLessThan(760);
      expect(y).toBeGreaterThan(480);
      expect(y).toBeLessThan(560);
    }
  });

  it("renders the master fully opaque, corner to corner", () => {
    // iOS composites the touch icon over white. One transparent pixel and the
    // tile grows a bright fringe on the home screen.
    const { data } = renderPixels(buildMark({ idPrefix: "t" }), 128);
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) transparent++;
    expect(transparent).toBe(0);
  });

  it("leaves its own corners square", () => {
    // The OS rounds the tile. Rounding it here too gives a double corner, which
    // is the single most reliable tell of a homemade icon.
    const { data, width, height } = renderPixels(buildMark({ idPrefix: "c" }), 128);
    const at = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ]) {
      // Painted, not cut away: a rounded master would leave these black-on-
      // nothing, and the alpha test above would already have caught bare
      // transparency, so check the corner carries actual field colour.
      const [r, g, b] = at(x, y);
      expect(r + g + b).toBeGreaterThan(0);
    }
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AA_LARGE_OR_UI,
  AA_TEXT,
  CHALK_STEPS,
  cardFace,
  chalkOnCard,
  contrastRatio,
  hexToRgb,
  lowestPassingStep,
  overlay,
  parseThemes,
} from "./contrast";

const CSS = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
const { dark, light } = parseThemes(CSS);

describe("the math itself", () => {
  it("agrees with the WCAG reference pairs", () => {
    // Black on white is the definition: 21:1.
    expect(contrastRatio(hexToRgb("#000000"), hexToRgb("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrastRatio(hexToRgb("#ffffff"), hexToRgb("#ffffff"))).toBeCloseTo(1, 5);
    // #767676 on white is the canonical "just passes AA" grey, and one shade
    // either side of it is the tightest check there is that the curve is right
    // rather than merely monotonic.
    expect(contrastRatio(hexToRgb("#767676"), hexToRgb("#ffffff"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(hexToRgb("#757575"), hexToRgb("#ffffff"))).toBeGreaterThan(AA_TEXT);
    expect(contrastRatio(hexToRgb("#777777"), hexToRgb("#ffffff"))).toBeLessThan(AA_TEXT);
  });

  it("measures the card face, not --surface", () => {
    // A .card paints --glass-surface over the page, so every ratio taken
    // against --surface alone describes a colour no pixel on screen has. In
    // dark mode that is #241d16 vs the ~#201a14 actually rendered.
    expect(cardFace(dark)).not.toEqual(hexToRgb(dark.surface));
    const [r, g, b] = cardFace(dark);
    expect([Math.round(r), Math.round(g), Math.round(b)]).toEqual([32, 26, 20]);
  });

  it("reads both themes out of globals.css rather than restating them", () => {
    // A second copy of a colour is how a palette and its accessibility
    // guarantee stop agreeing.
    expect(dark.bg).toBe("#100e0b");
    expect(light.surface).toBe("#ffffff");
    expect(light.glass).toBeGreaterThan(dark.glass);
  });
});

describe("where the muted-text ladder stops being legible", () => {
  /**
   * These pin the PALETTE, not the call sites. Almost every muted label in this
   * app is 9-14px, so AA's 4.5:1 applies and the 3:1 large-text exemption is
   * not available to it. UX-06 named its suspects by feel; these are the
   * numbers, and they move if anyone edits --text, --surface or --bg.
   */
  it("light mode is legible from /60 up, and not below", () => {
    expect(lowestPassingStep(light, CHALK_STEPS, AA_TEXT)).toBe(60);
    expect(chalkOnCard(light, 60)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(chalkOnCard(light, 55)).toBeLessThan(AA_TEXT);
  });

  it("dark mode is legible from /50 up, and not below", () => {
    // The dark ground has more range to give, which is why the same class is
    // fine at night and not in daylight — and why a single ladder cannot serve
    // both themes at the same alpha.
    expect(lowestPassingStep(dark, CHALK_STEPS, AA_TEXT)).toBe(50);
    expect(chalkOnCard(dark, 50)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(chalkOnCard(dark, 45)).toBeLessThan(AA_TEXT);
  });

  it("confirms UX-06's three suspects with numbers", () => {
    // "light chalk/50-55 table headers" — both fail, by a lot rather than a hair.
    expect(chalkOnCard(light, 50)).toBeLessThan(AA_TEXT);
    expect(chalkOnCard(light, 55)).toBeLessThan(AA_TEXT);
    // "dark /35-/45 decorative labels" — /35 fails even the 3:1 bar.
    expect(chalkOnCard(dark, 35)).toBeLessThan(AA_LARGE_OR_UI);
    expect(chalkOnCard(dark, 45)).toBeLessThan(AA_TEXT);
    // "edge-on-card" — light mode misses AA by three hundredths.
    expect(contrastRatio(hexToRgb(light.edge), cardFace(light))).toBeLessThan(AA_TEXT);
    expect(contrastRatio(hexToRgb(light.edge), cardFace(light))).toBeGreaterThan(AA_LARGE_OR_UI);
  });
});

describe("the solid tokens", () => {
  it("keeps --text-dim legible in both themes, since it carries most labels", () => {
    // 441 usages — by far the most-used muted token, and the one that has to
    // hold if anything does.
    expect(contrastRatio(hexToRgb(dark.dim), cardFace(dark))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(hexToRgb(light.dim), cardFace(light))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps --push legible in both themes", () => {
    expect(contrastRatio(hexToRgb(dark.push), cardFace(dark))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(hexToRgb(light.push), cardFace(light))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("records that --accent clears the UI bar but NOT the body-text bar in light mode", () => {
    // This is a finding, not an assertion of correctness: --accent is a BRAND
    // colour (docs/BRAND.md owns it), so the fix is a decision rather than an
    // edit, and it is tracked as UX-06b. It is fine where it is used as a focus
    // ring or a control border (SC 1.4.11 asks 3:1); it is not fine on 11px
    // text, and it appears in 277 className strings.
    const onCard = contrastRatio(hexToRgb(light.accent), cardFace(light));
    expect(onCard).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
    expect(onCard).toBeLessThan(AA_TEXT);
    // Dark mode has no such problem, which is why this was easy to miss.
    expect(contrastRatio(hexToRgb(dark.accent), cardFace(dark))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("focus rings", () => {
  it("clears SC 1.4.11 against the surface they are drawn on, in both themes", () => {
    // `focus-visible:outline-accent` is the app's established pattern. A focus
    // indicator is a non-text control, so 3:1 is the bar it has to clear.
    for (const t of [dark, light]) {
      expect(contrastRatio(hexToRgb(t.accent), cardFace(t))).toBeGreaterThanOrEqual(
        AA_LARGE_OR_UI,
      );
      expect(contrastRatio(hexToRgb(t.accent), hexToRgb(t.bg))).toBeGreaterThanOrEqual(
        AA_LARGE_OR_UI,
      );
    }
  });

  it("records WHY a border swap alone was not enough, and only in light mode", () => {
    /* 17 inputs used `focus:outline-none` with nothing but `focus:border-accent`
       to mark focus. Measured against the idle border they replace:

         dark   chalk/12 6.81   chalk/15 6.19   chalk/25 4.45
         light  chalk/12 2.95   chalk/15 2.77   chalk/25 2.20

       So the same markup is an obvious focus change at night and a barely
       perceptible one in daylight — exactly the light-mode gap the Aug 21
       quality floor exists to find, and invisible to anyone testing in the
       default theme. The fix is the outline those inputs now carry beside the
       border, matching the pattern the other 23 focusable elements already use.

       Asserted in both directions so this cannot quietly become false: if
       someone darkens --accent enough for light mode to clear the bar, this
       test fails and the comment gets rewritten rather than rotting. */
    for (const border of [0.12, 0.15, 0.25]) {
      const darkIdle = overlay(hexToRgb(dark.text), cardFace(dark), border);
      expect(contrastRatio(hexToRgb(dark.accent), darkIdle)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
      const lightIdle = overlay(hexToRgb(light.text), cardFace(light), border);
      expect(contrastRatio(hexToRgb(light.accent), lightIdle)).toBeLessThan(AA_LARGE_OR_UI);
    }
  });
});

describe("no element removes its focus outline without replacing it", () => {
  /**
   * `focus:outline-none` with nothing after it leaves a keyboard user with no
   * indication of where they are. 17 inputs were in that state — all of them
   * marking focus with `focus:border-accent` alone, which the measurement above
   * shows is a 2.2–2.95:1 change in light mode.
   *
   * Scanning the source rather than trusting the fix: this is the kind of class
   * string that gets copied into the next form.
   */
  // A hand-rolled walk rather than `fs.globSync`: it is Node 22+ and still
  // absent from the installed @types/node, so it typechecks in CI and not
  // locally — the sort of split that costs a red deploy to discover.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.name.endsWith(".tsx") ? [full] : [];
    });
  const FILES = walk(join(__dirname, ".."));

  it("finds every tsx file to scan", () => {
    // A glob that silently matches nothing would make the assertion below
    // vacuously true, which is the failure mode of every source-scanning test.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("pairs every outline-none with a focus-visible replacement", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const txt = readFileSync(file, "utf8");
      for (const m of txt.matchAll(/class(?:Name)?=\{?"([^"]*)"/g)) {
        const cls = m[1];
        if (!cls.includes("outline-none")) continue;
        if (cls.includes("focus-visible:outline") || cls.includes("focus-visible:ring")) continue;
        offenders.push(`${file}:${txt.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders, `focus outline removed with no replacement:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });
});

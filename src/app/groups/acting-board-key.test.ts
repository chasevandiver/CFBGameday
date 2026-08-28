import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The boards must REMOUNT when the acting subject (or the week) changes.
 *
 * PickBoard and SurvivorPicker seed their highlight state from the server's
 * rows on mount and then move it by taps. The "Picking for" switcher (0081)
 * and the week chevrons are same-route navigations, so React keeps the
 * component instance and only the props change — and mount-seeded state does
 * not follow props. The visible defect: make Jeff's picks, switch to John,
 * and Jeff's highlights are still painted over John's board while the writes
 * (correctly) go to John. Reported by the owner 2026-08-28, day one of seats.
 *
 * The fix is a `key` naming the subject and the week at both usage sites,
 * which none of the components can assert about themselves — hence a source
 * scan, the same blunt instrument groups.test.ts uses for the roster query.
 */
describe("the boards remount when the acting subject or week changes", () => {
  it("the pick'em board is keyed by week and subject", () => {
    const src = readFileSync(
      new URL("./[slug]/picks/page.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(
      /<PickBoard[\s\S]*?key=\{`\$\{seasonType\}:\$\{week\}:\$\{actingFor\?\.userId \?\? "me"\}`\}/,
    );
  });

  it("the survivor picker is keyed by week and subject", () => {
    const src = readFileSync(
      new URL("./[slug]/SurvivorHome.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(
      /<SurvivorPicker[\s\S]*?key=\{`\$\{weekRef\.seasonType\}:\$\{weekRef\.week\}:\$\{actingFor\?\.userId \?\? "me"\}`\}/,
    );
  });
});

// @vitest-environment jsdom
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeContent } from "./WelcomeContent";
import { INVITE_EMAIL, INVITE_MAILTO } from "./parts";

// Reached through CardShowcase → GameCard, which imports the server action.
vi.mock("../../app/actions/bets", () => ({ voidBet: vi.fn(async () => ({ ok: true })) }));

afterEach(cleanup);

/**
 * The marketing page is the one page opened by someone with no reason to
 * forgive it, and it links out more than any other page on the site. A dead
 * link here is not a broken link, it is a broken first impression.
 *
 * So the routes are checked against the filesystem rather than against a list
 * someone remembers to update: a page that gets renamed or removed fails this
 * test, which is the only way a static pitch page can stay honest about what it
 * is pointing at.
 */
const APP = join(process.cwd(), "src", "app");

/** Every static route with a `page.tsx`, as URL paths. Dynamic segments are
 *  skipped — `/welcome` deliberately links to no `[id]` route, and asserting
 *  that is part of the point. */
function staticRoutes(dir = APP, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") out.push(prefix || "/");
    if (!entry.isDirectory()) continue;
    // Route groups, private folders, dynamic segments and api routes.
    if (/^[[(_@]/.test(entry.name) || entry.name === "api") continue;
    out.push(...staticRoutes(join(dir, entry.name), `${prefix}/${entry.name}`));
  }
  return out;
}

const hrefs = (el: HTMLElement) =>
  [...el.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");

describe("the welcome page's links", () => {
  const routes = new Set(staticRoutes());

  it("finds the routes it is supposed to be checking against", () => {
    // Guards the walker itself: a bug that returned nothing would make every
    // assertion below vacuous in the wrong direction.
    expect(routes.has("/welcome")).toBe(true);
    expect(routes.has("/demo/slate")).toBe(true);
    expect(routes.size).toBeGreaterThan(15);
  });

  it("only points at pages that exist", () => {
    const { container } = render(<WelcomeContent />);
    const internal = hrefs(container).filter((h) => h.startsWith("/"));

    expect(internal.length).toBeGreaterThan(10);
    for (const href of internal) {
      expect(routes, `${href} is linked from /welcome`).toContain(href.split(/[?#]/)[0]);
    }
  });

  it("offers the invite ask as a mailto, twice, and nothing else off-site", () => {
    const { container } = render(<WelcomeContent />);
    const external = hrefs(container).filter((h) => !h.startsWith("/") && !h.startsWith("#"));

    expect(external).toEqual([INVITE_MAILTO, INVITE_MAILTO]);
    expect(INVITE_MAILTO.startsWith(`mailto:${INVITE_EMAIL}?`)).toBe(true);
  });

  it("sends people into the demo before it asks them for anything", () => {
    const { container } = render(<WelcomeContent />);
    const all = hrefs(container);
    expect(all.indexOf("/demo")).toBeLessThan(all.indexOf(INVITE_MAILTO));
  });
});

import { describe, expect, it } from "vitest";
import {
  DESKTOP_ITEMS,
  NAV_ITEMS,
  PRIMARY_ITEMS,
  SECONDARY_ITEMS,
  isNavItemActive,
  type NavItem,
} from "./nav-items";

const byLabel = (label: string): NavItem => {
  const item = NAV_ITEMS.find((i) => i.label === label);
  if (!item) throw new Error(`no nav item labelled ${label}`);
  return item;
};

describe("isNavItemActive", () => {
  it("matches Home on the root path only", () => {
    expect(isNavItemActive(byLabel("Home"), "/")).toBe(true);
  });

  /**
   * The regression this file exists for. Prefix-matching "/" is true for every
   * pathname in the app, so a naive implementation lights Home everywhere and
   * two tabs read as current at once.
   */
  it.each(["/slate", "/ledger", "/groups/sunday-crew", "/game/401", "/edges"])(
    "does not match Home on %s",
    (pathname) => {
      expect(isNavItemActive(byLabel("Home"), pathname)).toBe(false);
    },
  );

  it("matches a route and its detail routes", () => {
    const slate = byLabel("Slate");
    expect(isNavItemActive(slate, "/slate")).toBe(true);
    expect(isNavItemActive(slate, "/game/401")).toBe(true);
    expect(isNavItemActive(slate, "/slate/preview")).toBe(true);
  });

  it("does not match a route that merely shares a prefix", () => {
    expect(isNavItemActive(byLabel("Teams"), "/team-notes")).toBe(false);
  });

  /**
   * The live collision R3-E1 introduced: Slate owns `/game` (its detail
   * route) and Games owns `/games`. Exact-or-slash matching keeps them apart,
   * but nothing said so until this test.
   */
  it("does not confuse /games with the slate's /game detail routes", () => {
    expect(isNavItemActive(byLabel("Slate"), "/games")).toBe(false);
    expect(isNavItemActive(byLabel("Games"), "/game/401")).toBe(false);
    expect(isNavItemActive(byLabel("Games"), "/games")).toBe(true);
  });

  it("keeps the Games tab lit while you are inside a game", () => {
    for (const pathname of ["/guess-lines", "/streak", "/guess-game", "/six-pack"]) {
      expect(isNavItemActive(byLabel("Games"), pathname)).toBe(true);
    }
  });

  it("marks exactly one item current on a given path", () => {
    for (const pathname of [
      "/",
      "/slate",
      "/ledger",
      "/groups",
      "/edges",
      "/receipts",
      "/games",
      "/game/401",
      "/streak",
      "/guess-lines",
    ]) {
      const active = NAV_ITEMS.filter((i) => isNavItemActive(i, pathname));
      expect(active.map((i) => i.label)).toHaveLength(1);
    }
  });
});

describe("nav slots", () => {
  /**
   * Both slot assertions below name their items literally rather than
   * counting them. A count cannot tell "Edges left" from "Games arrived" —
   * it passed unchanged through exactly that swap in R3-E1, which is how a
   * semantic change hides behind a green test. Changing either list should
   * take an edit here that says what changed and why.
   */
  it("gives the bottom bar five primary items, Home first", () => {
    // Five, deliberately (R3-E1). Games is the fifth slot and Edges paid for
    // it by giving up its desktop tab (UX-33, answered 2026-08-17). Six cells
    // including More is ~62px each at 375px and ~53px at 320px, both inside
    // DESIGN.md's 44px rule against a 64px bar.
    expect(PRIMARY_ITEMS.map((i) => i.label)).toEqual([
      "Home",
      "Slate",
      "Games",
      "Ledger",
      "Groups",
    ]);
  });

  it("puts everything else behind More", () => {
    expect(SECONDARY_ITEMS.map((i) => i.label)).toContain("Edges");
    expect(PRIMARY_ITEMS.length + SECONDARY_ITEMS.length).toBe(NAV_ITEMS.length);
  });

  it("keeps /edges reachable even though it holds no slot in either nav", () => {
    // overflowOnly is a demotion, not a deletion: the More sheet still
    // carries it and the slate still links to it.
    expect(NAV_ITEMS.some((i) => i.href === "/edges")).toBe(true);
    expect(DESKTOP_ITEMS.map((i) => i.label)).not.toContain("Edges");
  });

  it("keeps mobile-only and overflow-only items out of the desktop strip", () => {
    expect(DESKTOP_ITEMS.map((i) => i.label)).toEqual([
      "Slate",
      "Games",
      "Rankings",
      "Ratings",
      "Standings",
      "Teams",
      "Ledger",
      "Groups",
      "Receipts",
    ]);
  });

  it("gives every bottom-bar item an icon", () => {
    for (const item of PRIMARY_ITEMS) expect(item.icon).toBeDefined();
  });
});

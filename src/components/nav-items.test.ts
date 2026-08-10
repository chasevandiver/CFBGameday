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

  it("marks exactly one item current on a given path", () => {
    for (const pathname of ["/", "/slate", "/ledger", "/groups", "/edges", "/receipts"]) {
      const active = NAV_ITEMS.filter((i) => isNavItemActive(i, pathname));
      expect(active.map((i) => i.label)).toHaveLength(1);
    }
  });
});

describe("nav slots", () => {
  it("gives the bottom bar four primary items, Home first", () => {
    expect(PRIMARY_ITEMS.map((i) => i.label)).toEqual(["Home", "Slate", "Ledger", "Groups"]);
  });

  it("puts everything else behind More", () => {
    expect(SECONDARY_ITEMS.map((i) => i.label)).toContain("Edges");
    expect(PRIMARY_ITEMS.length + SECONDARY_ITEMS.length).toBe(NAV_ITEMS.length);
  });

  it("keeps mobile-only items out of the desktop strip", () => {
    expect(DESKTOP_ITEMS.map((i) => i.label)).not.toContain("Home");
    expect(DESKTOP_ITEMS).toHaveLength(NAV_ITEMS.length - 1);
  });

  it("gives every bottom-bar item an icon", () => {
    for (const item of PRIMARY_ITEMS) expect(item.icon).toBeDefined();
  });
});

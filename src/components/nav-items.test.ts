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
    // Five, deliberately (R3-E1). Edges paid for the fifth slot by giving up
    // its desktop tab (UX-33, answered 2026-08-17). Six cells including More
    // is ~62px each at 375px and ~53px at 320px, both inside DESIGN.md's 44px
    // rule against a 64px bar.
    //
    // GROUPS AND GAMES SWAPPED 2026-08-21, owner call. The pool is what people
    // open the app to do on a Saturday — picks, the crew, the board — and it
    // was sitting one slot from the More sheet while the arcade held the
    // middle of the thumb zone. Nothing about the count or the widths changes;
    // this is which of the two is easier to reach with a thumb.
    expect(PRIMARY_ITEMS.map((i) => i.label)).toEqual([
      "Home",
      "Slate",
      "Groups",
      "Ledger",
      "Games",
    ]);
  });

  it("badges Groups and nothing else", () => {
    // A pick is the only thing in this app that expires. A badge that can
    // appear for anything else is one people stop seeing, which costs exactly
    // the Saturday it was built for.
    expect(NAV_ITEMS.filter((i) => i.badge).map((i) => i.label)).toEqual(["Groups"]);
    expect(NAV_ITEMS.find((i) => i.label === "Groups")?.badge).toBe("picks-due");
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

  it("keeps /jumbotron in the More sheet only (R5-A)", () => {
    // A takeover surface, not a daily destination: the slate's Live view
    // carries the loud entry while games are on; More keeps it reachable
    // the rest of the week without spending a tab.
    expect(NAV_ITEMS.some((i) => i.href === "/jumbotron")).toBe(true);
    expect(DESKTOP_ITEMS.map((i) => i.label)).not.toContain("Jumbotron");
  });

  it("keeps mobile-only and overflow-only items out of the desktop strip", () => {
    // Same swap as the bottom bar, and for the reason the module header
    // gives: one list drives both navs, and keeping a second order for
    // desktop is how the two drift apart.
    expect(DESKTOP_ITEMS.map((i) => i.label)).toEqual([
      "Slate",
      "Groups",
      "Rankings",
      "Ratings",
      "Standings",
      "Teams",
      "Ledger",
      "Games",
      "Receipts",
    ]);
  });

  it("gives every bottom-bar item an icon", () => {
    for (const item of PRIMARY_ITEMS) expect(item.icon).toBeDefined();
  });
});

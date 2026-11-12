import { describe, expect, it } from "vitest";
import {
  DESKTOP_ITEMS,
  NAV_ITEMS,
  PRIMARY_ITEMS,
  SECONDARY_ITEMS,
  isBottomTabActive,
  isNavItemActive,
  slateViewOf,
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
      "/model",
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
  it("gives the bottom bar Home, Slate, the three leagues and Groups", () => {
    // NAV-2, owner call 2026-11-12: "Home, Slate, CFB, NFL, CBB, Groups, and
    // move everything else to More." Seven cells including More is ~56px each
    // at 390px and ~46px at 320px — tighter than the five-item bar this
    // replaced (R3-E1), and still inside DESIGN.md's 44px rule against a 64px
    // bar. Ledger and Games gave up their slots and live behind More.
    expect(PRIMARY_ITEMS.map((i) => i.label)).toEqual([
      "Home",
      "Slate",
      "CFB",
      "NFL",
      "CBB",
      "Groups",
    ]);
    expect(SECONDARY_ITEMS.map((i) => i.label)).toEqual(
      expect.arrayContaining(["Ledger", "Games", "CBB Model"]),
    );
  });

  it("points each slate tab at its own view", () => {
    const href = (label: string) => byLabel(label).href;
    expect(href("Slate")).toBe("/slate?sport=live");
    expect(href("CFB")).toBe("/slate");
    expect(href("NFL")).toBe("/slate?sport=nfl");
    expect(href("CBB")).toBe("/slate?sport=cbb");
  });

  it("keeps the desktop header at one Slate tab, on the default board", () => {
    // The leagues are a click away on the page there and the header is full.
    const labels = DESKTOP_ITEMS.map((i) => i.label);
    expect(labels).toContain("Slate");
    for (const l of ["CFB", "NFL", "CBB", "Home"]) expect(labels).not.toContain(l);
    expect(byLabel("Slate").desktopHref).toBe("/slate");
    // Ledger and Games left the bottom bar, not the header.
    expect(labels).toEqual(expect.arrayContaining(["Ledger", "Games"]));
  });

  it("badges nothing at all", () => {
    /* The Groups tab carried a picks-due count for a few hours on 2026-08-21
       and the owner's read of it was "there's a 9+ notification on the groups
       tab which is confusing." They were right: a number floating over an icon
       cannot say what it is counting, and the hub's Groups card can say the
       whole sentence. The count moved there; nothing here is badged. */
    expect(NAV_ITEMS.every((i) => !("badge" in i))).toBe(true);
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

  it("keeps /model in the More sheet only (NAV-1)", () => {
    // Owner report 2026-08-26: no way to reach the model page from the PWA.
    // Reference material, not a daily destination — same demotion-not-deletion
    // shape as Edges: a More row, no desktop tab (the header is full at nine).
    expect(NAV_ITEMS.some((i) => i.href === "/model")).toBe(true);
    expect(DESKTOP_ITEMS.map((i) => i.label)).not.toContain("Model");
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

/**
 * NAV-2. Four bottom tabs share `/slate` and differ only by `?sport=`. A path
 * match alone lights all four at once, which is the same two-tabs-current
 * defect the Home test above exists for, four wide.
 */
describe("isBottomTabActive", () => {
  const lit = (pathname: string, sport: string | null) =>
    PRIMARY_ITEMS.filter((i) => isBottomTabActive(i, pathname, sport)).map((i) => i.label);

  it("lights exactly the league in view on the slate", () => {
    expect(lit("/slate", null)).toEqual(["CFB"]);
    expect(lit("/slate", "nfl")).toEqual(["NFL"]);
    expect(lit("/slate", "cbb")).toEqual(["CBB"]);
    expect(lit("/slate", "live")).toEqual(["Slate"]);
  });

  it("reads an unknown sport the way the slate page does — as CFB", () => {
    expect(slateViewOf("nba")).toBe("cfb");
    expect(lit("/slate", "nba")).toEqual(["CFB"]);
  });

  it("gives a game page to Slate, since its URL names no league", () => {
    expect(lit("/game/401", null)).toEqual(["Slate"]);
  });

  it("leaves every other tab to the ordinary path match", () => {
    expect(lit("/", null)).toEqual(["Home"]);
    expect(lit("/groups/sunday-crew", null)).toEqual(["Groups"]);
    // a More-sheet route lights nothing in the bar
    expect(lit("/ledger", null)).toEqual([]);
    expect(lit("/model/cbb", null)).toEqual([]);
  });

  it("keeps the two model pages apart in the More sheet", () => {
    expect(isNavItemActive(byLabel("CBB Model"), "/model/cbb")).toBe(true);
    expect(isNavItemActive(byLabel("Model"), "/model/cbb")).toBe(false);
    expect(isNavItemActive(byLabel("Model"), "/model/stats")).toBe(true);
  });
});

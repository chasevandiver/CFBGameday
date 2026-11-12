import {
  BarChart3,
  FlaskConical,
  Gamepad2,
  Home,
  MonitorPlay,
  Receipt,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";
import { BasketballIcon, FootballIcon } from "./nav-icons";

export interface NavItem {
  label: string;
  href: string;
  /** Extra path prefixes that should mark this item current (detail routes). */
  also?: string[];
  /** Holds a permanent slot in the mobile bottom bar. */
  primary?: true;
  /**
   * The slate view this item opens, when it is one (NAV-2). The four slate
   * tabs share a pathname and differ only by `?sport=`, so a path match alone
   * would light all four at once; this is what tells them apart. `"cfb"` is
   * the bare `/slate` — football's is the default league and its URL carries
   * no param.
   */
  slate?: "live" | "cfb" | "nfl" | "cbb";
  /**
   * Takes a bottom-bar slot but no desktop tab. The header wordmark already
   * links to `/`, and a tenth tab does not fit the `md` header beside the
   * wordmark, the auth button and the theme toggle.
   */
  mobileOnly?: true;
  /**
   * More-sheet only: no desktop tab and no bottom-bar slot.
   *
   * Added for `/edges` (UX-33, answered 2026-08-17). Edges are information,
   * not a destination — `--diagnose-edges` measured flagged edges at 49.2%
   * against the close, which is why the changelog demoted them from bets in
   * the first place. A permanent tab is the strongest destination claim the
   * app can make, and Games earns it more. The flag exists rather than
   * deleting the item because `/edges` must stay reachable and linked.
   */
  overflowOnly?: true;
  icon?: ComponentType<{ size?: number | string; "aria-hidden"?: boolean }>;
  /** Where the desktop tab goes when that differs from the bottom bar's. */
  desktopHref?: string;
}

/**
 * One source of truth for primary navigation. The desktop header renders the
 * non-`mobileOnly` ones in order; the mobile bottom bar renders the four
 * `primary` ones and puts the rest behind More. Splitting the list in two
 * places is how the two navs drift apart, so don't.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/", primary: true, mobileOnly: true, icon: Home },
  /* NAV-2, owner call 2026-11-12: Home · Slate · CFB · NFL · CBB · Groups in
     the bottom bar, everything else behind More.

     Three leagues made the league the thing people navigate by, and it was
     two taps away (Slate, then the toggle at the top of the page). Each
     league gets a slot; "Slate" becomes the cross-league Live view, so it is
     the one tab that is not a duplicate of another.

     On the desktop header there is one Slate tab, as before: the page's own
     toggle is a click away there and the header is already full. So the three
     league items are `mobileOnly`, and Slate's desktop href stays `/slate`
     (see `desktopHref`). */
  {
    label: "Slate",
    href: "/slate?sport=live",
    desktopHref: "/slate",
    also: ["/game"],
    primary: true,
    slate: "live",
    icon: BarChart3,
  },
  { label: "CFB", href: "/slate", primary: true, mobileOnly: true, slate: "cfb", icon: FootballIcon },
  { label: "NFL", href: "/slate?sport=nfl", primary: true, mobileOnly: true, slate: "nfl", icon: Shield },
  { label: "CBB", href: "/slate?sport=cbb", primary: true, mobileOnly: true, slate: "cbb", icon: BasketballIcon },
  /* Owner call, 2026-08-21: Groups takes the third slot and Games takes the
     fifth. The pool is what people open the app to do on a Saturday — picks,
     the crew, the board — and it was sitting one slot from the More sheet
     while the arcade held the middle of the thumb zone. Order in this array is
     the order in both navs, which is the point of one list. */
  {
    label: "Groups",
    href: "/groups",
    also: ["/crew", "/rules"],
    primary: true,
    icon: Users,
  },
  { label: "Edges", href: "/edges", overflowOnly: true, icon: TrendingUp },
  // R5-A: a takeover surface, not a daily destination — the slate's Live
  // view carries the loud entry when games are on; this keeps it reachable
  // the rest of the time without spending a tab on it.
  { label: "Jumbotron", href: "/jumbotron", overflowOnly: true, icon: MonitorPlay },
  { label: "Rankings", href: "/rankings" },
  { label: "Ratings", href: "/ratings" },
  /* NAV-1, owner report 2026-08-26: "I don't see a model tab on the pwa."
     Correct — /model was reachable only through the receipts footer and the
     welcome tour, an accident of history rather than a decision. Same shape
     as Edges: the methodology page is reference, not a daily destination, so
     it takes a More-sheet row, not one of the nine desktop tabs the header
     is already full at. Sits by Ratings because that's the page it explains. */
  { label: "Model", href: "/model", overflowOnly: true, icon: FlaskConical },
  // CBB-16: the basketball model's own record. Sits by Model for the reason
  // Model sits by Ratings — it is the page that explains the numbers beside it.
  { label: "CBB Model", href: "/model/cbb", overflowOnly: true, icon: FlaskConical },
  { label: "Standings", href: "/standings" },
  { label: "Teams", href: "/teams", also: ["/team"] },
  // NAV-2: out of the bottom bar and into More, with Games, to make room for
  // the leagues. Still a desktop tab.
  { label: "Ledger", href: "/ledger", icon: Receipt },
  // The game layer, one tab (R3-E1). `also` covers every game route so
  // playing one keeps the tab lit; `/games` cannot collide with Slate's
  // `/game` because isNavItemActive matches exact-or-slash, never bare prefix.
  {
    label: "Games",
    href: "/games",
    also: ["/guess-lines", "/streak", "/guess-game", "/six-pack", "/tape", "/chains", "/depth-chart"],
    icon: Gamepad2,
  },
  { label: "Receipts", href: "/receipts", also: ["/recap"] },
];

export const PRIMARY_ITEMS = NAV_ITEMS.filter((i) => i.primary);
export const SECONDARY_ITEMS = NAV_ITEMS.filter((i) => !i.primary);
export const DESKTOP_ITEMS = NAV_ITEMS.filter((i) => !i.mobileOnly && !i.overflowOnly);

/**
 * True when `pathname` is this item's route or one of its detail routes.
 *
 * `/` is matched exactly. Prefix-matching it would light the Home tab on every
 * page in the app, since every pathname starts with a slash.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const match = (p: string) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`);
  // `/model/cbb` is its own item; without this the Model row would light too.
  if (item.href === "/model" && match("/model/cbb")) return false;
  // The three league tabs exist in the bottom bar only, where
  // `isBottomTabActive` reads the query string for them. By path alone they
  // are indistinguishable from Slate, which owns the path here.
  if (item.slate && item.slate !== "live") return false;
  return match(item.href.split("?")[0]) || (item.also ?? []).some(match);
}

/** Which slate view a `?sport=` value names. Anything unrecognised is CFB,
 *  exactly as the slate page reads it. */
export function slateViewOf(sport: string | null | undefined): NonNullable<NavItem["slate"]> {
  return sport === "live" || sport === "nfl" || sport === "cbb" ? sport : "cfb";
}

/**
 * The bottom bar's "you are here" (NAV-2).
 *
 * Four of its tabs are the same pathname, so the path alone cannot choose.
 * On `/slate` the `?sport=` value picks exactly one. On a game page — which
 * belongs to the slate but carries no league in its URL — the Slate tab takes
 * it, as it always has. Everything else is the ordinary path match.
 */
export function isBottomTabActive(
  item: NavItem,
  pathname: string,
  sport: string | null | undefined,
): boolean {
  if (!item.slate) return isNavItemActive(item, pathname);
  if (pathname === "/slate" || pathname.startsWith("/slate/")) return item.slate === slateViewOf(sport);
  return item.slate === "live" && isNavItemActive(item, pathname);
}

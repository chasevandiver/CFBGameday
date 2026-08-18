import { BarChart3, Gamepad2, Home, Receipt, TrendingUp, Users } from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  label: string;
  href: string;
  /** Extra path prefixes that should mark this item current (detail routes). */
  also?: string[];
  /** Holds a permanent slot in the mobile bottom bar. */
  primary?: true;
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
}

/**
 * One source of truth for primary navigation. The desktop header renders the
 * non-`mobileOnly` ones in order; the mobile bottom bar renders the four
 * `primary` ones and puts the rest behind More. Splitting the list in two
 * places is how the two navs drift apart, so don't.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/", primary: true, mobileOnly: true, icon: Home },
  { label: "Slate", href: "/slate", also: ["/game"], primary: true, icon: BarChart3 },
  // The game layer, one tab (R3-E1). `also` covers every game route so
  // playing one keeps the tab lit; `/games` cannot collide with Slate's
  // `/game` because isNavItemActive matches exact-or-slash, never bare prefix.
  {
    label: "Games",
    href: "/games",
    also: ["/guess-lines", "/streak", "/guess-game", "/six-pack", "/tape", "/chains"],
    primary: true,
    icon: Gamepad2,
  },
  { label: "Edges", href: "/edges", overflowOnly: true, icon: TrendingUp },
  { label: "Rankings", href: "/rankings" },
  { label: "Ratings", href: "/ratings" },
  { label: "Standings", href: "/standings" },
  { label: "Teams", href: "/teams", also: ["/team"] },
  { label: "Ledger", href: "/ledger", primary: true, icon: Receipt },
  { label: "Groups", href: "/groups", also: ["/crew", "/rules"], primary: true, icon: Users },
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
  return match(item.href) || (item.also ?? []).some(match);
}

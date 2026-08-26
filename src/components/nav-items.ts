import {
  BarChart3,
  FlaskConical,
  Gamepad2,
  Home,
  MonitorPlay,
  Receipt,
  TrendingUp,
  Users,
} from "lucide-react";
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
  { label: "Standings", href: "/standings" },
  { label: "Teams", href: "/teams", also: ["/team"] },
  { label: "Ledger", href: "/ledger", primary: true, icon: Receipt },
  // The game layer, one tab (R3-E1). `also` covers every game route so
  // playing one keeps the tab lit; `/games` cannot collide with Slate's
  // `/game` because isNavItemActive matches exact-or-slash, never bare prefix.
  {
    label: "Games",
    href: "/games",
    also: ["/guess-lines", "/streak", "/guess-game", "/six-pack", "/tape", "/chains", "/depth-chart"],
    primary: true,
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
  return match(item.href) || (item.also ?? []).some(match);
}

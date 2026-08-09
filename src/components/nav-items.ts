import { BarChart3, Receipt, TrendingUp, Users } from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  label: string;
  href: string;
  /** Extra path prefixes that should mark this item current (detail routes). */
  also?: string[];
  /** Holds a permanent slot in the mobile bottom bar. */
  primary?: true;
  icon?: ComponentType<{ size?: number | string; "aria-hidden"?: boolean }>;
}

/**
 * One source of truth for primary navigation. The desktop header renders all
 * of these in order; the mobile bottom bar renders the four `primary` ones
 * and puts the rest behind More. Splitting the list in two places is how the
 * two navs drift apart, so don't.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Slate", href: "/slate", also: ["/game"], primary: true, icon: BarChart3 },
  { label: "Edges", href: "/edges", primary: true, icon: TrendingUp },
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

/** True when `pathname` is this item's route or one of its detail routes. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const match = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  return match(item.href) || (item.also ?? []).some(match);
}

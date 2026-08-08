"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavItemActive } from "./nav-items";

/**
 * Desktop primary nav with the current page marked (aria-current + accent).
 * Hidden below `md`, where BottomNav takes over — all nine tabs fit a wide
 * header without scrolling, but on a phone they never did.
 */
export function NavTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="hidden flex-1 gap-0.5 md:flex">
      {NAV_ITEMS.map((tab) => {
        const active = isNavItemActive(tab, pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-surface text-accent shadow-[inset_0_-2px_0_var(--accent)]"
                : "text-dim hover:bg-surface hover:text-chalk"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

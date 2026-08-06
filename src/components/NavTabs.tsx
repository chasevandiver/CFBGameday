"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: Array<{ label: string; href: string; also?: string[] }> = [
  { label: "Slate", href: "/slate", also: ["/game"] },
  { label: "Edges", href: "/edges" },
  { label: "Rankings", href: "/rankings" },
  { label: "Ratings", href: "/ratings" },
  { label: "Standings", href: "/standings" },
  { label: "Teams", href: "/teams", also: ["/team"] },
  { label: "Ledger", href: "/ledger" },
  { label: "Crew", href: "/crew", also: ["/rules"] },
  { label: "Receipts", href: "/receipts", also: ["/recap"] },
];

/** Primary nav with the current page marked (aria-current + accent). */
export function NavTabs() {
  const pathname = usePathname();
  const isActive = (tab: (typeof TABS)[number]) =>
    pathname === tab.href ||
    pathname.startsWith(`${tab.href}/`) ||
    (tab.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <nav aria-label="Primary" className="scroll-thin flex flex-1 gap-0.5 overflow-x-auto">
      {TABS.map((tab) => {
        const active = isActive(tab);
        return (
          <Link
            key={tab.label}
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

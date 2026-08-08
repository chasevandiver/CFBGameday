"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PRIMARY_ITEMS, SECONDARY_ITEMS, isNavItemActive } from "./nav-items";

/**
 * Mobile primary navigation, in the thumb zone (docs/DESIGN.md). Replaces the
 * horizontally scrolling top tab strip below `md`, where the last tabs sat
 * off-screen with no affordance and the targets were ~30px tall.
 *
 * Four routes hold a slot; the rest live behind More. The bar is fixed, so
 * `body` reserves room for it in globals.css and the bet slip lifts above it.
 */
export function BottomNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        moreRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    sheetRef.current?.querySelector("a")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const moreActive = SECONDARY_ITEMS.some((i) => isNavItemActive(i, pathname));

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[35] bg-background/70 backdrop-blur-[2px] md:hidden"
        />
      )}

      <div
        ref={sheetRef}
        id="nav-more-sheet"
        hidden={!open}
        className="fixed inset-x-0 bottom-0 z-40 rounded-t-xl border-t border-chalk/10 bg-elev px-4 pt-4 md:hidden"
        style={{ paddingBottom: "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 1rem)" }}
      >
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">More</p>
        <div className="grid grid-cols-2 gap-2">
          {SECONDARY_ITEMS.map((item) => {
            const active = isNavItemActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                /* a tap here navigates — the sheet must not outlive the route */
                onClick={() => setOpen(false)}
                className={`flex min-h-12 items-center rounded-lg border px-3 text-sm font-semibold transition-colors ${
                  active
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-chalk/10 text-chalk hover:border-chalk/25"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      <nav
        aria-label="Primary"
        data-bottom-nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-chalk/10 bg-background/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {PRIMARY_ITEMS.map((item) => {
          const active = isNavItemActive(item, pathname);
          const Icon = item.icon!;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                active
                  ? "text-chalk shadow-[inset_0_2px_0_var(--accent)]"
                  : "text-dim hover:text-chalk"
              }`}
              style={{ minHeight: "var(--bottom-nav-h)" }}
            >
              <Icon size={21} aria-hidden />
              {item.label}
            </Link>
          );
        })}

        <button
          ref={moreRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="nav-more-sheet"
          /* The accent bar means "you are here", so it belongs to More only
             when a sheet route is current — not merely because it's open,
             which would light two tabs at once. */
          className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
            moreActive
              ? "text-chalk shadow-[inset_0_2px_0_var(--accent)]"
              : open
                ? "text-chalk"
                : "text-dim hover:text-chalk"
          }`}
          style={{ minHeight: "var(--bottom-nav-h)" }}
        >
          <MoreHorizontal size={21} aria-hidden />
          More
        </button>
      </nav>
    </>
  );
}

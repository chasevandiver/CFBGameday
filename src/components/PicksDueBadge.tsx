"use client";

import { useEffect, useState } from "react";
import { badgeLabel } from "../lib/picks-due";

/**
 * The count of picks the viewer still owes, on the Groups tab.
 *
 * Owner request, 2026-08-21: "a notification if they haven't made all of their
 * picks yet." A pick is the one thing in this app that expires, and until now
 * the only thing that said so was a push notification — which needs a group
 * week to exist, permission to have been granted, and the phone to be nearby.
 * The tab is always there.
 *
 * Fetched after paint rather than rendered on the server: `AppNav` is on every
 * page, and this would otherwise be a query every route pays for. It also
 * refreshes when the tab regains focus, because the common shape is making
 * picks in another tab and coming back.
 *
 * Silent at zero. A badge that is always lit is furniture.
 */
export function PicksDueBadge() {
  const [open, setOpen] = useState(0);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/picks-due");
        if (!res.ok) return;
        const data = (await res.json()) as { open?: number };
        if (live) setOpen(data.open ?? 0);
      } catch {
        // A nav badge must never be the thing that breaks a page.
      }
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const label = badgeLabel(open);
  if (!label) return null;
  return (
    <span
      aria-label={`${open} pick${open === 1 ? "" : "s"} still to make`}
      className="stat absolute -right-1 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-accent-ink"
    >
      {label}
    </span>
  );
}

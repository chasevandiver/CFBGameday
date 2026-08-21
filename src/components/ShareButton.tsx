"use client";

import { Share } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSessionPicks } from "../lib/session-picks";
import { shareOrCopy } from "../lib/share-sheet";
import {
  SHARE_MODES,
  shareText,
  type ShareContext,
  type ShareMode,
  type SharePick,
} from "../lib/share-text";

/**
 * Opens the iOS share sheet with a member's picks as plain text.
 *
 * The share-sheet-or-clipboard mechanics live in `shareOrCopy`, shared with
 * the bet slip's own share.
 *
 * "Just placed" is the default and reads from the session store rather than
 * from the database, because a row's timestamp cannot distinguish the batch
 * you just tapped from one you made this morning.
 */
export function ShareButton({
  context,
}: {
  /** Everything except `justPlaced`, which only the client knows. */
  context: Omit<ShareContext, "justPlaced">;
}) {
  const sessionKeys = useSessionPicks();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ right: number; top?: number; bottom?: number } | null>(null);

  /* POOL-4, 2026-08-21. Owner report: "the share button for the pickem doesn't
     pop anything up — it looks like it's getting caught where it doesn't show
     up because it's being clipped by another card."

     Two faults, either of which alone hides the menu, and neither is clipping
     by a card:

     1. DIRECTION. The menu opened downward (`mt-1.5`) from a button that lives
        in PickBoard's FIXED BOTTOM BAR. There is no "below" there — the menu
        rendered past the bottom of the viewport.
     2. STACKING. That bar is `z-20` and creates its own stacking context, so a
        `z-30` child cannot rise above the bottom nav at `z-40`. Positioned
        correctly it would still have opened underneath the nav.

     A portal to `document.body` answers both, and every overflow ancestor any
     future caller might add. Position is measured from the button and flipped
     when there is no room below, so the same component is right in the ledger
     header, in GroupHub, and in the thumb-zone bar. */
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    /* Nominal, not measured: four items at 44px plus the card's padding. The
       menu is a fixed list, so a constant is honest here, and measuring would
       mean rendering it invisibly first to ask how tall it is. */
    const MENU_H = 200;
    const room = window.innerHeight - r.bottom;
    setAt(
      room >= MENU_H + 8
        ? { right: window.innerWidth - r.right, top: r.bottom + 6 }
        : { right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 6 },
    );
  };

  /* Placed once on open. Scrolling or resizing closes it rather than chasing
     the button: a menu that follows the page is a menu the page can drag
     off-screen, and dismissing is what someone scrolling meant anyway. */
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const justPlaced: SharePick[] = context.today.filter((p) => sessionKeys.includes(p.key));
  const full: ShareContext = { ...context, justPlaced };

  const send = async (mode: ShareMode) => {
    setOpen(false);
    const outcome = await shareOrCopy(shareText(mode, full));
    if (outcome === "shared" || outcome === "dismissed") return;
    setNote(outcome === "copied" ? "Copied" : "Could not share");
    setTimeout(() => setNote(null), 1800);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => {
          if (!open) place();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        className="stat flex min-h-11 items-center gap-1.5 rounded-lg border border-chalk/20 px-3 text-xs font-semibold text-chalk hover:border-chalk/50"
      >
        <Share size={14} aria-hidden />
        {note ?? "Share"}
      </button>

      {open &&
        at &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            {/* Tap-anywhere-else to dismiss, the way a native sheet behaves.
                z-50 — above the bottom nav's z-40, which the old in-place
                backdrop could not reach from inside a z-20 parent. */}
            <button
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 cursor-default"
            />
            <div
              role="menu"
              className="card fixed z-50 w-56 overflow-hidden p-1"
              style={{ right: at.right, top: at.top, bottom: at.bottom }}
            >
              {SHARE_MODES.map((m) => (
                <button
                  key={m.key}
                  role="menuitem"
                  onClick={() => void send(m.key)}
                  className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm text-chalk hover:bg-accent/12 hover:text-accent"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

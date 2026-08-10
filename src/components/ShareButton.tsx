"use client";

import { Share } from "lucide-react";
import { useState } from "react";
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
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="stat flex min-h-11 items-center gap-1.5 rounded-lg border border-chalk/20 px-3 text-xs font-semibold text-chalk hover:border-chalk/50"
      >
        <Share size={14} aria-hidden />
        {note ?? "Share"}
      </button>

      {open && (
        <>
          {/* Tap-anywhere-else to dismiss, the way a native sheet behaves. */}
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 cursor-default"
          />
          <div
            role="menu"
            className="card absolute right-0 z-30 mt-1.5 w-56 overflow-hidden p-1"
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
        </>
      )}
    </div>
  );
}

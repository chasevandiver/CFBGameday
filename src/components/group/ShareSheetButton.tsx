"use client";

import { Share } from "lucide-react";
import { useState } from "react";
import { shareOrCopy } from "../../lib/share-sheet";
import { bettingSheetText, type SheetShare } from "../../lib/share-text";

/**
 * Texting the sheet.
 *
 * One button, not a menu: a betting group has exactly one thing worth sending
 * — what everybody has on this week — and the message carries a link back to
 * the slate so a reader can get on any of it in a tap. `ShareButton`'s four
 * modes are a pick'em vocabulary (today's picks, day record, lifetime) and
 * none of them describe a sheet.
 */
export function ShareSheetButton({ sheet }: { sheet: SheetShare }) {
  const [note, setNote] = useState<string | null>(null);

  return (
    <button
      onClick={async () => {
        const outcome = await shareOrCopy(bettingSheetText(sheet));
        if (outcome === "shared" || outcome === "dismissed") return;
        setNote(outcome === "copied" ? "Copied" : "Could not share");
        setTimeout(() => setNote(null), 1800);
      }}
      className="stat inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-chalk/20 px-3.5 text-sm font-semibold text-chalk hover:border-chalk/50"
    >
      <Share size={14} aria-hidden />
      {note ?? "Share the sheet"}
    </button>
  );
}

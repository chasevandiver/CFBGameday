"use client";

import { Share } from "lucide-react";
import { useState } from "react";
import { shareOrCopy } from "../../lib/share-sheet";

/**
 * Hands the week's board — matchups, lines, totals — to the OS share sheet,
 * so an admin can text or email the family what this week's games are (owner
 * request 2026-08-28).
 *
 * A single action rather than ShareButton's menu: there is exactly one thing
 * to share here, and the text is built server-side on the page from the same
 * rows the board renders, so what lands in iMessage is what is on screen.
 * `shareOrCopy` does the sheet-or-clipboard dance every other share point
 * uses; on desktop, "Copied" is the whole story.
 */
export function BoardShare({ text }: { text: string }) {
  const [note, setNote] = useState<string | null>(null);

  const send = async () => {
    const outcome = await shareOrCopy(text);
    if (outcome === "shared" || outcome === "dismissed") return;
    setNote(outcome === "copied" ? "Copied" : "Could not share");
    setTimeout(() => setNote(null), 1800);
  };

  return (
    <button
      onClick={() => void send()}
      className="stat inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-chalk/20 px-3 text-xs font-semibold text-chalk hover:border-chalk/50"
    >
      <Share size={14} aria-hidden />
      {note ?? "Share the board"}
    </button>
  );
}

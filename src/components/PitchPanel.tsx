"use client";

import { ExternalLink, Share } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { shareOrCopy } from "../lib/share-sheet";

/**
 * The commissioner's handle on `/welcome`.
 *
 * The marketing page is public and unlinked from the app's own navigation, so
 * without this the only way to send it to somebody is to remember the path and
 * type it. This puts it next to the invite form, which is where the job
 * actually happens: you send the pitch, they read it, they ask, you add their
 * address to the allowlist.
 *
 * Shares the URL as plain text through `shareOrCopy` — the same share-sheet-or-
 * clipboard path the picks and the bet slip use, so it behaves identically on
 * a phone and on a desktop browser with no share sheet.
 */
export function PitchPanel() {
  /* Read from the browser rather than rendered on the server: the origin is not
     knowable during SSR without trusting a header, and a guess that disagrees
     with the browser is a hydration mismatch. Until hydration, the path alone is
     shown — which is true, just not copyable.

     `useSyncExternalStore` rather than an effect that sets state, which is the
     same thing with an extra render and is what the lint rule is about. The
     origin cannot change without a navigation, so the subscribe function has
     nothing to subscribe to. */
  const url = useSyncExternalStore(
    () => () => {},
    () => `${window.location.origin}/welcome`,
    () => null,
  );
  const [note, setNote] = useState<string | null>(null);

  const send = async () => {
    if (!url) return;
    const outcome = await shareOrCopy(url);
    if (outcome === "dismissed") return;
    setNote(
      outcome === "shared" ? "Shared" : outcome === "copied" ? "Link copied" : "Could not share",
    );
    setTimeout(() => setNote(null), 1800);
  };

  return (
    <section className="card mb-4 p-4">
      <h2 className="mb-1 text-sm text-accent">The pitch page</h2>
      <p className="mb-3 text-xs leading-relaxed text-chalk/60">
        A public page explaining what the site is and how it works, for someone who has never seen
        it. Nothing on it needs an account. It sends people into the demo first and asks for an
        invite second — when one lands in your inbox, add the address below.
      </p>

      <p className="stat mb-3 truncate text-xs text-dim">{url ?? "/welcome"}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/welcome"
          className="stat inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-chalk/20 px-3 text-xs font-semibold text-chalk hover:border-chalk/50"
        >
          <ExternalLink size={14} aria-hidden />
          View it
        </Link>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!url}
          className="stat inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-ink disabled:opacity-60"
        >
          <Share size={14} aria-hidden />
          {note ?? "Share the link"}
        </button>
      </div>
      {/* The button's label doubles as the confirmation, which a screen reader
          would otherwise never hear — the focused element's name changing is
          not an announcement. */}
      <p role="status" aria-live="polite" className="sr-only">
        {note ?? ""}
      </p>
    </section>
  );
}

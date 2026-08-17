"use client";

import { CalendarPlus, Check, Copy, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { rotateCalendarToken } from "../app/actions/profile";

/**
 * The subscribe-once calendar card (R2-A3). The URL is the credential
 * (migration 0054), so the two affordances are copy and rotate — there is no
 * on/off, because an unshared URL costs nothing.
 *
 * Built from `window.location.origin` at click time rather than an env var:
 * the copy button is a gesture handler, so the origin the user is on is by
 * definition the origin the feed lives on.
 */
export function CalendarSettings({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const path = `/api/calendar/${token}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be denied; the visible URL below is the fallback.
    }
  };

  return (
    <section className="card mt-4 p-4">
      <div className="mb-1 flex items-center gap-2">
        <CalendarPlus className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="text-sm text-accent">Calendar feed</h2>
      </div>
      <p className="mb-3 text-xs text-dim">
        Subscribe once and your favorites&rsquo; kickoffs (with TV), pick deadlines and survivor
        deadlines stay in your phone&rsquo;s calendar. In Apple or Google Calendar, add a calendar
        &ldquo;from URL&rdquo; and paste this.
      </p>
      <p className="stat mb-3 break-all rounded-lg bg-elev px-3 py-2 text-xs text-chalk/80 ring-1 ring-inset ring-chalk/8">
        {path}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-60"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
          {copied ? "Copied" : "Copy URL"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => void rotateCalendarToken())}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-chalk/70 ring-1 ring-inset ring-chalk/15 transition-colors hover:bg-elev disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden />
          Rotate
        </button>
        <span className="text-[10px] text-dim">Rotating kills the old URL.</span>
      </div>
    </section>
  );
}

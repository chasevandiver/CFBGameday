"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * The settled half of a hub section, folded away behind its own record.
 *
 * A `<details>` rather than a hand-rolled toggle: it is a disclosure by
 * definition, so it arrives with the keyboard behaviour and the screen-reader
 * semantics already correct, and its children stay server-rendered — the hub is
 * a server component and this is the only part of it that needs a browser.
 *
 * Closed by default, every time, because the hub's job is "what have I got
 * riding" and a settled game is not an answer to that. The preference is
 * remembered per device, so someone who likes it open stops having to say so.
 *
 * **Uncontrolled on purpose.** The obvious shape — `useState` seeded from an
 * effect — is a cascading render and the linter says so; it is also a hydration
 * hazard, since the server has no way to know what this browser last chose. The
 * element owns its own state, the effect nudges the DOM once, and React is
 * never told. Both storage calls are guarded: a private window, cleared site
 * data or a browser refusing storage must render the section, not throw over a
 * chevron.
 */
export function SettledDisclosure({
  storageKey,
  summary,
  count,
  children,
}: {
  storageKey: string;
  summary: ReactNode;
  /** How many rows are behind the fold — the thing the label cannot say. */
  count: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === "open" && ref.current) {
        ref.current.open = true;
      }
    } catch {
      /* storage refused — closed is the right default anyway */
    }
  }, [storageKey]);

  return (
    <details ref={ref} className="mt-3.5">
      {/* `card card-hover`, not bare text. Owner report 2026-08-22 with a
          screenshot: "the settled expand option needs to stand out way more —
          I almost missed it." It was a 10.5px label on the page background
          sitting between two glass cards, which is the visual grammar of a
          section HEADING, not a control. On a card surface it reads as an
          object you can press, and `min-h-11` finally clears DESIGN.md's 44px
          target, which the old py-2 row did not. */}
      <summary
        className="card card-hover flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2.5 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&::-webkit-details-marker]:hidden"
        onClick={() => {
          // Fires before the element toggles, so the value being stored is the
          // one it is about to have.
          try {
            window.localStorage.setItem(
              storageKey,
              ref.current?.open ? "closed" : "open",
            );
          } catch {
            /* the section still works; only the preference is lost */
          }
        }}
      >
        {summary}
        {/* The app's own "this is yours / this is interactive" vocabulary — the
            same accent chip a logged bet wears — so the affordance is one the
            eye has already been taught on this page. The count says what is
            behind it; the chevron says which way it goes. */}
        <span className="chip ml-auto bg-accent/15 text-accent ring-1 ring-inset ring-accent">
          {count} {count === 1 ? "game" : "games"}
          <ChevronDown
            size={12}
            aria-hidden
            className="shrink-0 transition-transform duration-150 motion-reduce:transition-none [details[open]_&]:rotate-180"
          />
        </span>
      </summary>
      {children}
    </details>
  );
}

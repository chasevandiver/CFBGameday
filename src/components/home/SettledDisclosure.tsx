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
  children,
}: {
  storageKey: string;
  summary: ReactNode;
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
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-1 py-2 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&::-webkit-details-marker]:hidden"
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
        <ChevronDown
          size={14}
          aria-hidden
          className="ml-auto shrink-0 text-dim transition-transform duration-150 motion-reduce:transition-none [details[open]_&]:rotate-180"
        />
      </summary>
      {children}
    </details>
  );
}

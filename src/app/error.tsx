"use client";

import { useEffect } from "react";
import { AppNav } from "../components/AppNav";

/**
 * Route error boundary — a Supabase hiccup gets a retry, not a stack trace.
 *
 * Renders the nav, like `not-found.tsx` and `loading.tsx` do. It is not in the
 * root layout (`layout.tsx` renders only `{children}` and a footer), so every
 * page mounts its own — and a boundary that skipped it left the reader on a
 * dead end with no way out but the back button (UX-27). `id="main"` goes with
 * it: `AppNav` renders a skip link to `#main`, so the nav arrives with a target
 * or it arrives broken.
 *
 * `retry` is the correct prop for this Next, not `reset`. Both exist —
 * `retry()` re-fetches and re-renders the segment, `reset()` only clears the
 * error state without re-fetching — and `retry` became stable in 16.3.0, the
 * version pinned here. See `next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/error.md`.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <AppNav />
      <main
        id="main"
        className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center"
      >
        <p className="display text-2xl text-chalk">Fumble on the play</p>
        <p className="max-w-sm text-sm text-dim">
          Something went wrong loading this page. It&rsquo;s usually transient — try again, and if
          it keeps happening the data layer is having a moment.
        </p>
        <button
          onClick={() => retry()}
          className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
        >
          Try again
        </button>
      </main>
    </>
  );
}

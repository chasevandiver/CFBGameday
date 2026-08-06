"use client";

import { useEffect } from "react";

/** Route error boundary — a Supabase hiccup gets a retry, not a stack trace. */
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
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <p className="display text-2xl text-chalk">Fumble on the play</p>
      <p className="max-w-sm text-sm text-dim">
        Something went wrong loading this page. It&rsquo;s usually transient — try again, and if
        it keeps happening the data layer is having a moment.
      </p>
      <button
        onClick={() => retry()}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
      >
        Try again
      </button>
    </main>
  );
}

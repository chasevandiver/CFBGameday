import Link from "next/link";
import { AppNav } from "../components/AppNav";

export default function NotFound() {
  return (
    <>
      <AppNav />
      <main id="main" className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <p className="display text-2xl text-chalk">4th &amp; forever</p>
        <p className="max-w-sm text-sm text-dim">
          That page doesn&rsquo;t exist — the game may have been removed, or the link is stale.
        </p>
        <Link
          href="/slate"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
        >
          Back to the slate
        </Link>
      </main>
    </>
  );
}

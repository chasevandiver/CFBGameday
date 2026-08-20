import Link from "next/link";
import { redirect } from "next/navigation";
import { WrappedStories } from "../../components/wrapped/WrappedStories";
import { createClient } from "../../lib/supabase/server";
import { buildWrapped } from "../../lib/wrapped";
import { demoWrappedInput, fetchWrappedInput, wrappedUnlocked } from "../../lib/wrapped-data";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wrapped",
  description: "Your season, one fact per card, straight from the receipts.",
};

/**
 * The Slate Wrapped (R5-C). Locked until the CFB national championship is
 * final — a half-season dressed as a season would be a lie, so before then
 * the page is a dated teaser and `?preview=1` renders FIXTURES only (the
 * /demo idiom), never partial real data. NFL bets are included as graded by
 * unlock; the Super Bowl postdates it, and the header would rather say so
 * than pretend otherwise.
 */
export default async function WrappedPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const { preview } = await searchParams;
  if (preview === "1") {
    const input = demoWrappedInput();
    return <WrappedStories year={input.year} cards={buildWrapped(input)} preview />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(await wrappedUnlocked(supabase))) {
    return (
      <main className="brand-surface bg-background flex min-h-dvh flex-col items-center justify-center px-7 text-center">
        <p className="stat text-[11px] uppercase tracking-[0.24em] text-dim">The Slate Wrapped</p>
        <h1 className="mt-4 text-4xl text-chalk">Not yet.</h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-dim">
          Wrapped opens when the college season ends — the night the national championship goes
          final. Until then the receipts are still being written.
        </p>
        <Link
          href="/"
          className="mt-8 flex min-h-11 items-center rounded-lg border border-chalk/20 px-4 text-sm font-medium text-chalk hover:border-chalk/40"
        >
          Back to The Slate
        </Link>
      </main>
    );
  }

  const input = await fetchWrappedInput(supabase, user.id);
  const cards = buildWrapped(input);
  if (cards.length === 0) {
    return (
      <main className="brand-surface bg-background flex min-h-dvh flex-col items-center justify-center px-7 text-center">
        <p className="stat text-[11px] uppercase tracking-[0.24em] text-dim">The Slate Wrapped</p>
        <h1 className="mt-4 text-4xl text-chalk">No season on record.</h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-dim">
          Wrapped is built from graded picks and settled bets, and this account has none this
          season. Next year starts in August.
        </p>
        <Link
          href="/"
          className="mt-8 flex min-h-11 items-center rounded-lg border border-chalk/20 px-4 text-sm font-medium text-chalk hover:border-chalk/40"
        >
          Back to The Slate
        </Link>
      </main>
    );
  }

  return <WrappedStories year={input.year} cards={cards} />;
}

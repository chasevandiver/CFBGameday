import { AppNav } from "../../../components/AppNav";
import { DemoBar } from "../../../components/DemoBar";
import { SlateView } from "../../../components/slate/SlateView";
import { demoSlateData, demoTickerData, DEMO_WEEK } from "../../../lib/demo-data";
import { demoNow } from "../../../lib/demo-now";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Demo slate",
  description: "A Saturday slate mid-afternoon, with invented numbers.",
};

/**
 * The slate, against sample data — twelve games posed mid-afternoon, three of
 * them live.
 *
 * `demo` is what makes this safe to leave open: the slate polls itself and
 * rides a realtime channel, and the first poll would replace this week with the
 * real signed-out one while somebody was looking at it.
 */
export default async function DemoSlatePage() {
  const now = await demoNow();
  return (
    <>
      {/* The demo ticker rides the sample slate — the live one polls /api/ticker,
          which would put real games (or an empty strip) above invented ones. */}
      <AppNav demoTicker={demoTickerData(now)} />
      <main id="main" className="w-full flex-1 px-4 pt-4">
        <DemoBar here="slate" />
        <SlateView initial={demoSlateData(now)} currentWeek={DEMO_WEEK} demo />
      </main>
    </>
  );
}

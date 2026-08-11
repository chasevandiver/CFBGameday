import { AppNav } from "../../components/AppNav";
import { DemoBar } from "../../components/DemoBar";
import { HomeDashboard } from "../../components/home/HomeHub";
import { demoHomeData, demoTickerData } from "../../lib/demo-data";
import { demoNow } from "../../lib/demo-now";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Demo",
  description: "What the hub looks like on a Saturday, with invented numbers.",
};

/**
 * The home hub, against sample data.
 *
 * Unlike `/slate/preview` — the design harness, which is dev-only because its
 * slip would write to the ledger — this is meant to be sent to someone. It is
 * public and it survives production: no session, no Supabase call, no season to
 * look up. The whole page is `demoHomeData` handed to the same component `/`
 * renders, so what a friend sees here is what they get.
 *
 * `force-dynamic` because the sample Saturday is anchored to whenever the page
 * is opened (see `lib/demo-data.ts`); prerendered at build time it would slowly
 * become a demo of last August.
 */
export default async function DemoHubPage() {
  const now = await demoNow();
  return (
    <>
      {/* The demo ticker rides the sample slate — the live one polls /api/ticker,
          which would put real games (or an empty strip) above invented ones. */}
      <AppNav demoTicker={demoTickerData(now)} />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <HomeDashboard
          data={demoHomeData(now)}
          signedIn
          note={<DemoBar here="hub" />}
          // Otherwise the hub's primary action walks out of the demo and into
          // the real signed-out slate, the one screen this exists to avoid.
          slateHref="/demo/slate"
        />
      </main>
    </>
  );
}

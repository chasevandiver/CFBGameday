import Link from "next/link";
import type { TickerData } from "../lib/ticker";
import { AuthButton } from "./AuthButton";
import { BottomNav } from "./BottomNav";
import { NavTabs } from "./NavTabs";
import { ScoreTicker } from "./ScoreTicker";
import { SlateMark } from "./SlateMark";
import { ThemeToggle } from "./ThemeToggle";

/** `demoTicker` swaps the live ticker for the sample slate's — see /demo. */
export function AppNav({ demoTicker }: { demoTicker?: TickerData } = {}) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-accent-ink"
      >
        Skip to content
      </a>
      {/* backdrop-filter earns its cost here: the slate scrolls underneath */}
      <header
        className="sticky top-0 z-20 border-b border-chalk/10 backdrop-blur-xl backdrop-saturate-150"
        style={{
          background: "var(--glass-bar)",
          boxShadow: "inset 0 -1px 0 var(--glass-edge)",
        }}
      >
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-4 px-4">
          {/* The lockup is the desktop route home — the Home tab is
              mobile-only, since a tenth tab does not fit this header. The mark
              carries the identity and the wordmark names the route, which is
              the order the brand puts them in. */}
          <Link
            href="/"
            aria-label="The CFB Slate — home"
            className="flex shrink-0 items-center gap-2 leading-none"
          >
            <SlateMark size={21} className="text-chalk" />
            <span className="display text-lg text-accent">The CFB Slate</span>
          </Link>
          <NavTabs />
          <div className="flex flex-1 items-center justify-end gap-4 md:flex-none">
            <AuthButton />
            <ThemeToggle />
          </div>
        </div>
      </header>
      {/* sticky under the header; publishes --ticker-h so other sticky bars
          offset below it */}
      <ScoreTicker demo={demoTicker} />
      {/* primary nav below md — the top strip is desktop-only now */}
      <BottomNav />
    </>
  );
}

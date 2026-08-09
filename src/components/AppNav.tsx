import Link from "next/link";
import { AuthButton } from "./AuthButton";
import { BottomNav } from "./BottomNav";
import { NavTabs } from "./NavTabs";
import { ScoreTicker } from "./ScoreTicker";
import { ThemeToggle } from "./ThemeToggle";

export function AppNav() {
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
          <Link href="/slate" className="display shrink-0 text-xl leading-none text-accent">
            The CFB Slate
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
      <ScoreTicker />
      {/* primary nav below md — the top strip is desktop-only now */}
      <BottomNav />
    </>
  );
}

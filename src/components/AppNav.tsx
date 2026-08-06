import Link from "next/link";
import { AuthButton } from "./AuthButton";
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
      <header className="sticky top-0 z-20 border-b border-chalk/10 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-4 px-4">
          <Link href="/slate" className="display shrink-0 text-xl leading-none text-accent">
            The CFB Slate
          </Link>
          <NavTabs />
          <AuthButton />
          <ThemeToggle />
        </div>
      </header>
      {/* below the sticky header so it scrolls away and the slate's sticky
          control bar keeps its top offset */}
      <ScoreTicker />
    </>
  );
}

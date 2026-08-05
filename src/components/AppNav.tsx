import Link from "next/link";
import { AuthButton } from "./AuthButton";
import { ScoreTicker } from "./ScoreTicker";
import { ThemeToggle } from "./ThemeToggle";

const TABS: Array<{ label: string; href: string; ready: boolean }> = [
  { label: "Slate", href: "/slate", ready: true },
  { label: "Edges", href: "/edges", ready: true },
  { label: "Ratings", href: "/ratings", ready: true },
  { label: "Teams", href: "/teams", ready: true },
  { label: "Ledger", href: "/ledger", ready: true },
  { label: "Crew", href: "/crew", ready: true },
  { label: "Receipts", href: "/receipts", ready: true },
];

export function AppNav() {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-chalk/10 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-4 px-4">
          <Link href="/slate" className="display shrink-0 text-xl leading-none text-accent">
            The CFB Slate
          </Link>
          <nav className="scroll-thin flex flex-1 gap-0.5 overflow-x-auto">
            {TABS.map((tab) =>
              tab.ready ? (
                <Link
                  key={tab.label}
                  href={tab.href}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-dim transition-colors hover:bg-surface hover:text-chalk"
                >
                  {tab.label}
                </Link>
              ) : (
                <span
                  key={tab.label}
                  title="Coming soon"
                  className="cursor-default rounded-lg px-3 py-1.5 text-sm text-chalk/25"
                >
                  {tab.label}
                </span>
              ),
            )}
          </nav>
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

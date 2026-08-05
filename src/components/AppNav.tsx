import Link from "next/link";

const TABS: Array<{ label: string; href: string; ready: boolean }> = [
  { label: "Slate", href: "/slate", ready: true },
  { label: "Ratings", href: "/ratings", ready: false },
  { label: "Teams", href: "/teams", ready: false },
  { label: "Ledger", href: "/ledger", ready: true },
  { label: "Crew", href: "/crew", ready: true },
  { label: "Receipts", href: "/receipts", ready: false },
];

export function AppNav() {
  return (
    <header className="sticky top-0 z-10 border-b border-chalk/10 bg-field-deep/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-4 overflow-x-auto px-4 py-3">
        <Link href="/slate" className="display shrink-0 text-lg text-gold">
          The CFB Slate
        </Link>
        <nav className="flex gap-1">
          {TABS.map((tab) =>
            tab.ready ? (
              <Link
                key={tab.label}
                href={tab.href}
                className="rounded px-3 py-1.5 text-sm text-chalk/80 hover:bg-surface hover:text-chalk"
              >
                {tab.label}
              </Link>
            ) : (
              <span
                key={tab.label}
                title="Coming soon"
                className="cursor-default rounded px-3 py-1.5 text-sm text-chalk/30"
              >
                {tab.label}
              </span>
            ),
          )}
        </nav>
      </div>
    </header>
  );
}

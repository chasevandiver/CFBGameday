const TABS = ["Slate", "Ratings", "Teams", "Game Cards", "Ledger", "Crew", "Receipts"];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <p className="stat text-sm tracking-[0.3em] text-gold uppercase">2026 season</p>
      <h1 className="text-4xl sm:text-6xl">The CFB Slate</h1>
      <p className="max-w-md text-chalk/80">
        Ratings, edges, pick&rsquo;em, and the crew ledger — what matters right now, every
        Saturday.
      </p>
      <nav className="flex flex-wrap justify-center gap-2">
        {TABS.map((tab) => (
          <span
            key={tab}
            className="rounded border border-chalk/20 bg-surface px-3 py-1.5 text-sm text-chalk/70"
          >
            {tab}
          </span>
        ))}
      </nav>
      <p className="stat text-xs text-chalk/50">Kickoff: Week 0 · Aug 29, 2026</p>
    </main>
  );
}

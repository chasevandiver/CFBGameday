import { AppNav } from "../../components/AppNav";

export const metadata = { title: "League Rules" };

/**
 * The pick'em rulebook, verbatim from the spec (§4) — ambiguity is the #1
 * source of arguments in betting groups, so the rules are product. The spec
 * required them displayed in-app; they lived only in the git repo (audit).
 */
export default function RulesPage() {
  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <h1 className="text-2xl">League Rules</h1>
        <p className="mb-6 mt-1 text-sm text-dim">
          The rulebook the grader actually enforces. Rules live in the schema, not in arguments.
        </p>

        <ol className="flex flex-col gap-4">
          <Rule n={1} title="Your line is the line when you tap.">
            A pick locks with the consensus line at the moment it&rsquo;s made
            (<code className="stat text-xs">line_at_pick</code>). Line-shopping timing is part of
            the skill, and it makes per-pick CLV meaningful. Two people on the same game can hold
            different numbers.
          </Rule>
          <Rule n={2} title="Edits re-snapshot.">
            Picks are editable until kickoff, but editing takes the <em>current</em> number — no
            keeping Tuesday&rsquo;s line with Saturday&rsquo;s information.
          </Rule>
          <Rule n={3} title="Kickoff is the lock, enforced by the database.">
            No pick writes at or after kickoff — rejected at the data layer, not by the honor
            system. Picks are visible to the whole crew at all times.
          </Rule>
          <Rule n={4} title="Push = no action.">
            Pushes don&rsquo;t count in the record or units. Postponed or canceled games are void.
          </Rule>
          <Rule n={5} title="Standings & tiebreakers.">
            The season leaderboard shows record, units (graded at −110: a win pays 0.909u per
            unit), ROI, and average CLV. Ordering is units, then ROI, then average CLV.
          </Rule>
          <Rule n={6} title="Your group sets the format.">
            Which games are in play each week, and which bet types you may pick, are set by your
            group&rsquo;s admin — handpicked, the full slate, or one conference, times spreads,
            totals and straight-up winners. A pick is one of: either side of the spread, the over,
            the under, or a team to win outright.
          </Rule>
          <Rule n={7} title="Conventions.">
            One unit per pick unless specified. A group can set a weekly minimum; the board shows
            how many you have in against it, and nothing is blocked or voided if you fall short.
            Straight-up picks carry no number, so they grade win or loss and never units, ROI or
            CLV — a group playing winners only has a leaderboard of records.
          </Rule>
          <Rule n={8} title="Bets are forever.">
            The ledger is append-only: bets can be voided (they stay on the page, struck through),
            never deleted. Grading fields are written by the Sunday job only. Everyone&rsquo;s
            numbers are visible to everyone — that transparency is what keeps a group betting
            site fun instead of ugly.
          </Rule>
          <Rule n={9} title="CLV is the arbiter.">
            Closing line value is measured against our own captured closing consensus — the last
            snapshots before kickoff. Beating the close consistently is the only evidence an edge
            is real; a hot record with negative CLV is luck on a timer.
          </Rule>
        </ol>
      </main>
    </>
  );
}

function Rule({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="card flex gap-3 p-4">
      <span className="stat shrink-0 text-lg font-semibold text-chalk/30">{n}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-chalk">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-dim">{children}</p>
      </div>
    </li>
  );
}

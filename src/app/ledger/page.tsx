import { AppNav } from "../../components/AppNav";
import { BetForm } from "../../components/BetForm";
import { VoidBetButton } from "../../components/VoidBetButton";
import { REASON_TAG_LABELS, type BetRow } from "../../lib/db-types";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);

  const { data } = await supabase
    .from("bets")
    .select("*")
    .eq("season_id", seasonId)
    .eq("user_id", user?.id ?? "")
    .order("placed_at", { ascending: false });
  const bets = (data ?? []) as BetRow[];

  const graded = bets.filter((b) => b.result && b.result !== "void");
  const wins = graded.filter((b) => b.result === "win").length;
  const losses = graded.filter((b) => b.result === "loss").length;
  const units = graded.reduce((a, b) => a + (b.payout_units ?? 0), 0);
  const staked = graded
    .filter((b) => b.result !== "push")
    .reduce((a, b) => a + b.units, 0);
  const withClv = graded.filter((b) => b.clv !== null);
  const avgClv =
    withClv.length > 0 ? withClv.reduce((a, b) => a + (b.clv as number), 0) / withClv.length : null;

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="mb-6 text-2xl">Ledger</h1>

        {/* Season dashboard */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Record" value={graded.length ? `${wins}-${losses}` : "–"} />
          <Stat
            label="Units"
            value={graded.length ? `${units >= 0 ? "+" : ""}${units.toFixed(1)}` : "–"}
            tone={units > 0 ? "gold" : units < 0 ? "flag" : undefined}
          />
          <Stat
            label="ROI"
            value={staked > 0 ? `${((units / staked) * 100).toFixed(1)}%` : "–"}
          />
          <Stat
            label="Avg CLV"
            value={avgClv === null ? "–" : `${avgClv > 0 ? "+" : ""}${avgClv.toFixed(2)}`}
            tone={avgClv !== null && avgClv > 0 ? "gold" : undefined}
          />
        </section>

        {/* Entry */}
        <section className="mb-8 rounded border border-chalk/10 bg-surface p-4">
          <h2 className="mb-3 text-sm text-gold">Log a bet</h2>
          <BetForm seasonId={seasonId} />
        </section>

        {/* History */}
        <section className="overflow-x-auto rounded border border-chalk/10 bg-surface">
          <table className="stats w-full text-sm">
            <thead>
              <tr className="border-b border-chalk/20 text-left text-xs uppercase text-chalk/50">
                <th className="px-3 py-2">Bet</th>
                <th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2 text-right">Line</th>
                <th className="px-3 py-2 text-right">Units</th>
                <th className="px-3 py-2 text-right">CLV</th>
                <th className="px-3 py-2 text-right">Result</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {bets.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-chalk/50">
                    No bets logged yet this season.
                  </td>
                </tr>
              )}
              {bets.map((b) => (
                <tr
                  key={b.id}
                  className={`border-b border-chalk/5 last:border-0 ${b.voided_at ? "opacity-40" : ""}`}
                >
                  <td className="max-w-[16rem] truncate px-3 py-2 font-sans">{b.description}</td>
                  <td className="px-3 py-2 text-xs text-chalk/60">
                    {REASON_TAG_LABELS[b.reason_tag as keyof typeof REASON_TAG_LABELS] ?? b.reason_tag}
                  </td>
                  <td className="px-3 py-2 text-right">{b.line_taken ?? "–"}</td>
                  <td className="px-3 py-2 text-right">{b.units}</td>
                  <td className="px-3 py-2 text-right">
                    {b.clv === null ? "–" : `${b.clv > 0 ? "+" : ""}${b.clv}`}
                  </td>
                  <td className="px-3 py-2 text-right uppercase">
                    {b.result ?? <span className="text-chalk/40">open</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!b.voided_at && !b.result && <VoidBetButton betId={b.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="mt-3 text-xs text-chalk/50">
          The ledger is append-only — bets can be voided, never deleted. Everyone&rsquo;s season
          numbers show on the Crew page.
        </p>
      </main>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gold" | "flag" }) {
  return (
    <div className="rounded border border-chalk/10 bg-surface p-3">
      <p className="text-xs uppercase text-chalk/50">{label}</p>
      <p className={`stat mt-1 text-xl ${tone === "gold" ? "text-gold" : tone === "flag" ? "text-flag" : ""}`}>
        {value}
      </p>
    </div>
  );
}

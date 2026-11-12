import Link from "next/link";
import { AppNav } from "../../../components/AppNav";
import { cbbDayLabel } from "../../../lib/cbb";
import {
  TIER_LABEL,
  hitPct,
  wlText,
  type CbbModelStats,
  type ConfidenceTier,
  type Wl,
} from "../../../lib/cbb-model-stats";
import { clockTime, DEFAULT_TZ, tzLabel } from "../../../lib/kick";
import { fetchCbbModelStats, fetchCurrentSeasonWeek } from "../../../lib/queries";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "CBB Model",
  description: "The college basketball model's record: season, by tier, and day by day.",
};

/**
 * The college basketball model's scoreboard (CBB-16).
 *
 * Owner request, 2026-11-12: the CBB model's stats, reachable from More and
 * from the CBB slate. Every number here is the cbbmodel repo's own — graded
 * there, by its rule, against its pick-time line — and arrives through the
 * feed (`cbb_model_stats`, 0087). This page reduces nothing and grades
 * nothing; it is that model's dashboard, in this app's clothes.
 *
 * Laid out as the questions come: is it winning, where is it winning, and how
 * has it done lately. Every rate sits beside its record, because half the
 * tiers are a few dozen games deep in November and a percentage alone would
 * hide that.
 */
export default async function CbbModelPage() {
  const supabase = await createClient();
  let stats: CbbModelStats | null = null;
  try {
    const { seasonId } = await fetchCurrentSeasonWeek(supabase, "cbb");
    stats = await fetchCbbModelStats(supabase, seasonId);
  } catch {
    /* no basketball season configured — the empty state below says so */
  }

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">CBB Model</h1>
          <Link href="/slate?sport=cbb" className="text-sm text-accent underline-offset-2 hover:underline">
            Tonight&rsquo;s board
          </Link>
        </div>

        {!stats || hitPct(stats.ats) === null ? (
          <div className="card mt-4 px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">No record yet</p>
            <p className="mt-1 text-sm text-dim">
              The model&rsquo;s record arrives with its daily feed and fills in as games go final.
            </p>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-dim">
              {stats.seasonLabel} · model {stats.modelVersion ?? "–"} · as of{" "}
              {clockTime(stats.generatedAt, DEFAULT_TZ)} {tzLabel(DEFAULT_TZ)}
            </p>

            <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Season">
              <Tile label="Against the spread" record={stats.ats} lead />
              <Tile
                label="Winners"
                value={
                  stats.su.total > 0 ? `${Math.round((stats.su.correct / stats.su.total) * 1000) / 10}%` : "–"
                }
                note={`${stats.su.correct} of ${stats.su.total}`}
              />
              {stats.days[0] && (
                <Tile label={cbbDayLabel(stats.days[0].date)} value={wlText(stats.days[0])} note="last graded day" />
              )}
              {stats.clv && (
                <Tile
                  label="Closing-line value"
                  value={stats.clv.avg === null ? "–" : `${stats.clv.avg > 0 ? "+" : ""}${stats.clv.avg}`}
                  note={`pts avg · ${stats.clv.n} picks`}
                />
              )}
            </section>

            <Table
              title="By tier"
              caption="What a card's hit rate is read from. A game counts in the most specific tier it qualifies for on its card, but these records overlap: every best bet is also in its confidence tier."
              rows={[
                ["Best bets", stats.bestBets],
                ["Value plays (edge 3+)", stats.valuePlays],
                ...(["high", "medium", "low"] as ConfidenceTier[]).map(
                  (t): [string, Wl] => [TIER_LABEL[t], stats!.byConfidence[t]],
                ),
              ]}
            />

            {stats.byEdge.length > 0 && (
              <Table
                title="By size of edge"
                caption="Points between the model's spread and the line at pick time."
                rows={stats.byEdge.map((b): [string, Wl] => [`${b.bucket} pts`, b])}
              />
            )}

            {stats.days.length > 0 && (
              <Table
                title="Day by day"
                caption="Against the spread, newest first."
                rows={stats.days.map((d): [string, Wl] => [cbbDayLabel(d.date), d])}
              />
            )}

            <p className="mt-4 text-xs leading-relaxed text-dim">
              These are the model&rsquo;s own numbers, graded in its own repo against the line at the
              time of each pick. A pick is counted when the model beats that line by more than half
              a point. Picks are information, not recommendations
              {stats.clv?.avg != null && stats.clv.avg <= 0
                ? " — closing-line value is flat, which means the market has not been moving toward them."
                : "."}
            </p>
          </>
        )}
      </main>
    </>
  );
}

function Tile({
  label,
  record,
  value,
  note,
  lead = false,
}: {
  label: string;
  record?: Wl;
  value?: string;
  note?: string;
  lead?: boolean;
}) {
  const pct = record ? hitPct(record) : null;
  return (
    <div className="card px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-chalk/50">{label}</p>
      <p className={`stat mt-1 font-semibold leading-none text-chalk ${lead ? "text-2xl" : "text-lg"}`}>
        {record ? (pct === null ? "–" : `${pct}%`) : value}
      </p>
      <p className="stat mt-1 text-[11px] text-dim">{record ? wlText(record) : note}</p>
    </div>
  );
}

/** Label · record · rate, one row each. Fixed columns, tabular figures. */
function Table({ title, caption, rows }: { title: string; caption: string; rows: Array<[string, Wl]> }) {
  return (
    <section className="card mt-4 overflow-hidden">
      <h2 className="border-b border-chalk/8 px-4 py-2.5 text-sm text-accent">{title}</h2>
      <table className="w-full">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-[10px] font-semibold uppercase tracking-wider text-chalk/50">
            <th scope="col" className="px-4 py-1.5 text-left font-semibold">
              {title === "Day by day" ? "Day" : "Tier"}
            </th>
            <th scope="col" className="stat px-2 py-1.5 text-right font-semibold">
              Record
            </th>
            <th scope="col" className="stat px-4 py-1.5 text-right font-semibold">
              Hit rate
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, r]) => {
            const pct = hitPct(r);
            return (
              <tr key={label} className="border-t border-chalk/8">
                <th scope="row" className="px-4 py-2 text-left text-sm font-normal text-chalk/85">
                  {label}
                </th>
                <td className="stat whitespace-nowrap px-2 py-2 text-right text-sm tabular-nums text-chalk">
                  {r.w + r.l + r.p === 0 ? "–" : wlText(r)}
                </td>
                <td className="stat whitespace-nowrap px-4 py-2 text-right text-sm tabular-nums text-chalk">
                  {pct === null ? "–" : `${pct}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-chalk/8 px-4 py-2 text-[11px] leading-snug text-dim">{caption}</p>
    </section>
  );
}

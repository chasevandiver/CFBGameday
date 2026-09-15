import { ChevronDown } from "lucide-react";
import { formatRecord, type Tally } from "../lib/records";
import type { LeagueSplit } from "../lib/week-records";

/**
 * "Week by week" — one week per row, each opening onto its days.
 *
 * Owner request, 2026-09-15: the record week by week, total and with CFB and
 * NFL broken out, and a way to see one week day by day. So the three numbers
 * the owner named are on every row at every level, and a week is a `<details>`
 * whose children are its days — the same idiom as `SourceCard`, for the same
 * reasons: keyboard and screen-reader semantics for free, server-rendered
 * children, no client JavaScript and no navigation to lose your place to.
 *
 * Weeks are the weekend, not a league's week number — see `lib/week-records.ts`
 * for why a row carrying both leagues cannot be keyed to either one's calendar.
 *
 * This component renders; it does not calculate. Every `Tally` here came out of
 * `records.ts`, and this file does not so much as add two of them together.
 */

/** Signed, one decimal, with the unit. The same shape the hub's `Units` prints. */
const fmtUnits = (u: number): string => `${u >= 0 ? "+" : ""}${u.toFixed(1)}u`;

/**
 * "12-7 +4.2u", or what is true instead.
 *
 * Nothing graded and nothing pending is a dash. Nothing graded with bets still
 * out is "3 open" — a week whose games have not been played is not an 0-0
 * week, and a dash there reads as "you did nothing", which is the opposite of
 * what is happening.
 */
export function RecordLine({ split, pending }: { split: LeagueSplit; pending: number }) {
  const t = split.total;
  if (t.decided === 0) {
    return (
      <span className="stat whitespace-nowrap text-chalk/35">
        {pending > 0 ? `${pending} open` : "—"}
      </span>
    );
  }
  return (
    <span className="stat whitespace-nowrap">
      <span className="text-sm text-chalk">{formatRecord(t)}</span>{" "}
      <span
        className={`text-[11px] ${
          t.units > 0 ? "text-win" : t.units < 0 ? "text-loss" : "text-chalk/60"
        }`}
      >
        {fmtUnits(t.units)}
      </span>
    </span>
  );
}

/**
 * "CFB 8-4 +3.1u · NFL 4-3 +1.1u".
 *
 * Only when **both** leagues graded something in this slice. A week, or a
 * Saturday, that was all CFB has a per-league record identical to its total,
 * and printing it twice on one row is not a breakdown — it is the same number
 * said again, which is how a dense row stops being read at all. Which league a
 * one-league slice was is already in the week's name ("Week 3" against "NFL
 * Week 2"), so nothing is lost. Same instinct as the ledger's league tiles,
 * which appear only once both leagues have graded bets.
 */
export function LeagueCaption({ split }: { split: LeagueSplit }) {
  if (split.cfb.decided === 0 || split.nfl.decided === 0) return null;
  const parts: Array<[string, Tally]> = [
    ["CFB", split.cfb],
    ["NFL", split.nfl],
  ];
  return (
    <span className="stat text-[11px] text-dim">
      {parts.map(([label, t], i) => (
        <span key={label}>
          {i > 0 && <span className="text-chalk/25"> · </span>}
          {label} <span className="text-chalk/70">{formatRecord(t)}</span>{" "}
          <span className={t.units > 0 ? "text-win" : t.units < 0 ? "text-loss" : ""}>
            {fmtUnits(t.units)}
          </span>
        </span>
      ))}
    </span>
  );
}

export interface DayRecordRow {
  key: string;
  /** "Sat" — the weekday, which is unique inside a football week. */
  label: string;
  split: LeagueSplit;
  pending: number;
}

export interface WeekRecordRow extends DayRecordRow {
  /** "Sep 10–14" — the days the bets were actually on. */
  range: string;
  days: DayRecordRow[];
}

export function WeekRecords({
  weeks,
  note = null,
  id = "week-records",
}: {
  weeks: WeekRecordRow[];
  /** What the weeks below leave out — say it, don't let the totals not add up. */
  note?: string | null;
  id?: string;
}) {
  if (weeks.length === 0) return null;
  return (
    <section className="mb-6" aria-labelledby={`${id}-heading`}>
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 id={`${id}-heading`} className="text-sm text-accent">
          Week by week
        </h2>
        <span className="h-px flex-1 bg-chalk/10" aria-hidden />
        <span className="stat text-[11px] text-dim">tap a week for its days</span>
      </div>
      <ul className="flex flex-col gap-2">
        {weeks.map((w) => (
          <li key={w.key} className="card overflow-hidden">
            <details>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 transition-colors hover:bg-chalk/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-chalk">{w.label}</span>
                  <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                    <span className="stat text-[11px] text-chalk/45">{w.range}</span>
                    <LeagueCaption split={w.split} />
                  </span>
                </span>
                <RecordLine split={w.split} pending={w.pending} />
                <ChevronDown
                  size={14}
                  aria-hidden
                  className="shrink-0 text-dim transition-transform duration-150 motion-reduce:transition-none [details[open]_&]:rotate-180"
                />
              </summary>
              <ul className="border-t border-chalk/8">
                {w.days.map((d) => (
                  <li
                    key={d.key}
                    className="flex min-h-11 items-center gap-2 border-b border-chalk/5 px-3.5 py-2 last:border-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="stat block text-sm text-chalk/80">{d.label}</span>
                      <LeagueCaption split={d.split} />
                    </span>
                    <RecordLine split={d.split} pending={d.pending} />
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-[11px] leading-relaxed text-dim">{note}</p>}
    </section>
  );
}

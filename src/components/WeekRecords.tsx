import { Fragment } from "react";
import { ChevronDown } from "lucide-react";
import { formatRecord, type Tally } from "../lib/records";
import type { LeagueSplit, SliceRecord } from "../lib/week-records";

/**
 * "Week by week" — one week per row, each opening onto its days.
 *
 * Owner request, 2026-09-15: the record week by week, total and with CFB and
 * NFL broken out, and a way to open a week onto its days. So the three numbers
 * the owner named are on every row at every level, and a week is a `<details>`
 * whose children are its days — the same idiom as `SourceCard`, for the same
 * reasons: keyboard and screen-reader semantics for free, server-rendered
 * children, no client JavaScript and no navigation to lose your place to.
 *
 * Weeks are the weekend, not a league's week number — see `lib/week-records.ts`
 * for why a row carrying both leagues cannot be keyed to either one's calendar.
 *
 * **Every row leads with where it stands right now**, not with what the grader
 * has settled (WEEK-3, owner: *"I want live week by week and day by day to see
 * how we're doing live"*). The settled record is never discarded — it sits
 * under the live one, labelled — because one of the two numbers is a fact and
 * the other is a position, and a ledger that quietly showed only the position
 * would be a ledger you could not reconcile.
 *
 * This component renders; it does not calculate. Every `Tally` here came out of
 * `records.ts`, and this file does not so much as add two of them together.
 */

/** Signed, one decimal, with the unit. The same shape the hub's `Units` prints. */
const fmtUnits = (u: number): string => `${u >= 0 ? "+" : ""}${u.toFixed(1)}u`;

const unitTone = (u: number): string =>
  u > 0 ? "text-win" : u < 0 ? "text-loss" : "text-chalk/60";

/** The pulsing dot the slate uses for a game being played. */
export function LiveDot() {
  return (
    <span
      className="live-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-live align-middle"
      aria-hidden
    />
  );
}

/**
 * Where a slice stands: the record as it would grade off the board right now.
 *
 * A slice with nothing on the board at all — no settled wager, nothing in
 * progress, nothing final and ungraded — says what it does have instead of
 * dashing. "3 to come" is an answer; a dash reads as "you did nothing", which
 * is the opposite of what is happening on a Friday.
 */
export function RecordLine({ record }: { record: SliceRecord }) {
  const t = record.now.total;
  if (t.decided === 0) {
    return (
      <span className="stat whitespace-nowrap text-chalk/35">
        {record.upcoming > 0 ? `${record.upcoming} to come` : "—"}
      </span>
    );
  }
  return (
    <span className="stat flex items-center justify-end gap-1 whitespace-nowrap">
      {record.live > 0 && <LiveDot />}
      <span className="text-sm text-chalk">{formatRecord(t)}</span>
      <span className={`text-[11px] ${unitTone(t.units)}`}>{fmtUnits(t.units)}</span>
    </span>
  );
}

/**
 * The line under the record: what in it is not final, and what is.
 *
 * Only appears when the two readings differ. A week whose games are all graded
 * has one record and saying "12-7 settled" under "12-7" would be noise; a week
 * with three games in progress has two records, and which is which is the whole
 * question.
 */
export function StandingNote({ record }: { record: SliceRecord }) {
  if (record.projected === 0) {
    return record.upcoming > 0 && record.now.total.decided > 0 ? (
      <span className="stat text-[10.5px] text-chalk/45">{record.upcoming} to come</span>
    ) : null;
  }
  const parts = [
    record.live > 0 ? `${record.live} live` : null,
    // Over, and the grader has not run. Named rather than folded into "live":
    // a Sunday-morning reader is looking at a number that will not move again.
    record.projected > record.live ? `${record.projected - record.live} not graded` : null,
    record.settled.total.decided > 0 ? `${formatRecord(record.settled.total)} settled` : null,
    record.upcoming > 0 ? `${record.upcoming} to come` : null,
  ].filter((p): p is string => p !== null);
  return <span className="stat text-[10.5px] text-chalk/45">{parts.join(" · ")}</span>;
}

/**
 * "CFB 8-4 +3.1u · NFL 4-3 +1.1u", as the board stands.
 *
 * Only when **both** leagues have something in this slice. A week, or a
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
  /* Each league is one unbreakable run, so a caption too wide for the column
     breaks between CFB and NFL rather than mid-figure — a record split over two
     lines ("NFL 2-1" / "+2.6u") reads as two different numbers. */
  return (
    <span className="stat block text-[11px] leading-snug text-dim">
      {parts.map(([label, t], i) => (
        <Fragment key={label}>
          {/* Outside the run, or its leading space collapses against the edge
              of the inline-block and the dot sticks to the previous number. */}
          {i > 0 && <span className="text-chalk/25"> · </span>}
          <span className="inline-block whitespace-nowrap">
            {label} <span className="text-chalk/70">{formatRecord(t)}</span>{" "}
            <span className={t.units > 0 ? "text-win" : t.units < 0 ? "text-loss" : ""}>
              {fmtUnits(t.units)}
            </span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}

export interface DayRecordRow {
  key: string;
  /** "Sat" — the weekday, which is unique inside a football week. */
  label: string;
  record: SliceRecord;
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
  const anyLive = weeks.some((w) => w.record.live > 0);
  return (
    <section className="mb-6" aria-labelledby={`${id}-heading`}>
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 id={`${id}-heading`} className="text-sm text-accent">
          Week by week
        </h2>
        <span className="h-px flex-1 bg-chalk/10" aria-hidden />
        <span className="stat flex items-center gap-1 text-[11px] text-dim">
          {anyLive && <LiveDot />}
          {anyLive ? "live, as it stands" : "tap a week for its days"}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {weeks.map((w) => (
          <li key={w.key} className="card overflow-hidden">
            <details open={w.record.live > 0}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 transition-colors hover:bg-chalk/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-chalk">{w.label}</span>
                  <span className="stat mt-0.5 block text-[11px] leading-snug text-chalk/45">
                    {w.range}
                  </span>
                  <LeagueCaption split={w.record.now} />
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <RecordLine record={w.record} />
                  <StandingNote record={w.record} />
                </span>
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
                      <LeagueCaption split={d.record.now} />
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <RecordLine record={d.record} />
                      <StandingNote record={d.record} />
                    </span>
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

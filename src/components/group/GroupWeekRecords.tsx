import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { LeagueCaption, LiveDot, RecordLine, StandingNote } from "../WeekRecords";
import { memberHref } from "./BettingHub";
import type { SliceRecord } from "../../lib/week-records";

/**
 * A betting group, week by week.
 *
 * Owner request, 2026-09-15, in the same breath as the ledger's: the record
 * week by week, total and CFB and NFL on their own, with a day breakdown inside
 * the week. On a betting group "the record" is never one record — it is every
 * member's, which is the only reason anybody opens the page. So a week opens
 * onto the roster ranked by that week's units, and the day fold under it ranks
 * the same roster one day at a time: who won Saturday, who gave it back Sunday.
 *
 * Both leagues, always, whatever tab the sheet above is on. The three cuts the
 * owner asked for are on every row — a section that hid the NFL because the
 * reader happened to be on the CFB tab would be answering a question nobody
 * asked. The heading says so.
 *
 * **The ranking is live** (WEEK-3). Members sort on the board as it stands, not
 * on what the grader has settled, so a 4pm Saturday read moves with the games
 * — which is the whole point of a group of people watching the same slate. The
 * settled record rides under each row, so nobody has to wonder which is which.
 *
 * Renders only. Every `Tally` came out of `records.ts` by way of
 * `lib/week-records.ts`; the atoms are the ledger's, so the two surfaces cannot
 * drift into two vocabularies for one number.
 */

export interface MemberRecordRow {
  userId: string;
  name: string;
  record: SliceRecord;
}

export interface GroupDayRow {
  key: string;
  label: string;
  record: SliceRecord;
  /** Ranked on the live standing; members with nothing in this slice are absent. */
  members: MemberRecordRow[];
}

export interface GroupWeekRow extends GroupDayRow {
  range: string;
  days: GroupDayRow[];
}

/**
 * "Jeff +6.2u" — the one thing a group wants off a collapsed week.
 *
 * As the board stands, so the name at the top of a Saturday changes while the
 * games are on. Before anything has a standing at all there is no leader, so
 * the week says what it does have: how much of it is still to come. `members`
 * arrives ranked, so the first member with a graded slice is the leader.
 */
function Leader({ members, record }: { members: MemberRecordRow[]; record: SliceRecord }) {
  const top = members.find((m) => m.record.now.total.decided > 0);
  if (!top) {
    return (
      <span className="stat whitespace-nowrap text-chalk/35">
        {record.upcoming > 0 ? `${record.upcoming} to come` : "—"}
      </span>
    );
  }
  const u = top.record.now.total.units;
  return (
    <span className="stat flex min-w-0 items-center justify-end gap-1 whitespace-nowrap">
      {record.live > 0 && <LiveDot />}
      <span className="text-sm text-chalk">{top.name.split(" ")[0]}</span>
      <span className={`text-[11px] ${u > 0 ? "text-win" : u < 0 ? "text-loss" : "text-chalk/60"}`}>
        {u >= 0 ? "+" : ""}
        {u.toFixed(1)}u
      </span>
    </span>
  );
}

function MemberRows({ members, slug }: { members: MemberRecordRow[]; slug: string | null }) {
  if (members.length === 0) {
    return <p className="px-3.5 py-3 text-xs text-dim">Nobody had a bet on this one.</p>;
  }
  return (
    <ul>
      {members.map((m) => (
        <li
          key={m.userId}
          className="flex min-h-11 items-center gap-2 border-b border-chalk/5 px-3.5 py-2 last:border-0"
        >
          <span className="min-w-0 flex-1">
            {slug ? (
              <Link
                href={memberHref(slug, m.userId, null)}
                className="block truncate text-sm text-chalk underline-offset-2 hover:underline"
              >
                {m.name}
              </Link>
            ) : (
              <span className="block truncate text-sm text-chalk">{m.name}</span>
            )}
            <LeagueCaption split={m.record.now} />
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <RecordLine record={m.record} />
            <StandingNote record={m.record} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function GroupWeekRecords({
  weeks,
  slug,
  note = null,
}: {
  weeks: GroupWeekRow[];
  /** Where a name links. Null on the demo and the preview, where ids are invented. */
  slug: string | null;
  note?: string | null;
}) {
  if (weeks.length === 0) return null;
  const anyLive = weeks.some((w) => w.record.live > 0);
  return (
    <section className="mb-7" aria-labelledby="group-weeks-heading">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 id="group-weeks-heading" className="text-sm text-accent">
          Week by week
        </h2>
        <span className="h-px flex-1 bg-chalk/10" aria-hidden />
        <span className="stat flex items-center gap-1 text-[11px] text-dim">
          {anyLive && <LiveDot />}
          {anyLive ? "live · both leagues" : "both leagues"}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {weeks.map((w) => (
          <li key={w.key} className="card overflow-hidden">
            {/* A week with games on opens itself: that is the week the page was
                opened to look at, and one tap saved on a phone held in one hand
                next to a TV is the whole brief. */}
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
                  <Leader members={w.members} record={w.record} />
                  <StandingNote record={w.record} />
                </span>
                <ChevronDown
                  size={14}
                  aria-hidden
                  className="shrink-0 text-dim transition-transform duration-150 motion-reduce:transition-none [details[open]_&]:rotate-180"
                />
              </summary>

              <div className="border-t border-chalk/8">
                <MemberRows members={w.members} slug={slug} />
              </div>

              {/* The day cut, folded: a week is the question, a day is the
                  follow-up, and five day tables open by default would bury the
                  week they belong to. It opens itself on the day something is
                  actually being played, for the same reason the week does. */}
              {w.days.length > 1 && (
                <details className="border-t border-chalk/8" open={w.record.live > 0}>
                  <summary className="stat flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3.5 py-2 text-[11px] uppercase tracking-wider text-chalk/45 transition-colors hover:bg-chalk/5 hover:text-chalk/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                    By day
                    <ChevronDown
                      size={12}
                      aria-hidden
                      className="text-dim transition-transform duration-150 motion-reduce:transition-none [details[open]_&]:rotate-180"
                    />
                  </summary>
                  {w.days.map((d) => (
                    <div key={d.key} className="border-t border-chalk/5">
                      <div className="flex items-center gap-2 bg-chalk/5 px-3.5 py-1.5">
                        {/* Set as a heading, not as another name: a day row
                            and a member row sit in one column, and "Sat" in
                            the same weight as "Sam Ruiz" reads as a bettor. */}
                        <span className="stat flex-1 text-[11px] uppercase tracking-wider text-chalk/45">
                          {d.label}
                        </span>
                        <LeagueCaption split={d.record.now} />
                        <RecordLine record={d.record} />
                      </div>
                      <MemberRows members={d.members} slug={slug} />
                    </div>
                  ))}
                </details>
              )}
            </details>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-[11px] leading-relaxed text-dim">{note}</p>}
    </section>
  );
}

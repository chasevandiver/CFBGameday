"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  sameWeek,
  seasonTypeLabel,
  shortWeekLabel,
  weekQuery,
  type WeekRef,
} from "../../lib/group-weeks";
import type { SeasonType } from "../../lib/season";

/**
 * Jump to any week of the season, grouped by which part of it you are in.
 *
 * The chevrons beside the heading walk one step at a time, which is the Sunday
 * motion ("how did last week go"). This is the other one: it is August, the
 * calendar is pointing at a preseason week, and the question is where the
 * regular season starts. Walking sixteen chevrons to find out is not an answer,
 * and before this there was no answer at all — the group pages had no control
 * that could change the season type (see `lib/group-weeks.ts`).
 *
 * `<optgroup>` per season type is the whole point: it is what makes "Pre 2" and
 * "Week 2" two different rows instead of one ambiguous number.
 */
export function WeekJump({
  base,
  weeks,
  current,
  sport,
  league = null,
}: {
  /** Route the selection lands on, e.g. `/groups/saturday-boys`. */
  base: string;
  weeks: WeekRef[];
  current: WeekRef;
  sport: "cfb" | "nfl";
  /** Carried through so a both-league group stays on the league in view. */
  league?: string | null;
}) {
  const router = useRouter();
  const types = [...new Set(weeks.map((w) => w.seasonType))] as SeasonType[];

  return (
    <label className="relative shrink-0">
      <span className="sr-only">Jump to week</span>
      <select
        value={`${current.seasonType}:${current.week}`}
        onChange={(e) => {
          const [t, w] = e.target.value.split(":");
          router.push(`${base}${weekQuery({ seasonType: t as SeasonType, week: Number(w) }, { league })}`);
        }}
        className="stat h-11 appearance-none rounded-lg border border-chalk/15 bg-elev pl-3 pr-8 text-sm text-chalk focus:border-accent/60 focus:outline-none"
      >
        {types.map((t) => (
          <optgroup key={t} label={seasonTypeLabel(t)}>
            {weeks
              .filter((w) => w.seasonType === t)
              .map((w) => (
                <option key={`${t}:${w.week}`} value={`${t}:${w.week}`}>
                  {shortWeekLabel(w, sport)}
                  {sameWeek(w, current) ? " ·" : ""}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dim"
      />
    </label>
  );
}

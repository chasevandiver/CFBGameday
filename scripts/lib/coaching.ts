/**
 * Head-coach transitions and coach quality from CFBD /coaches.
 *
 * The preseason model had `coaching: 0` hardcoded for every team — the one
 * component of §2.1 with no data source. This module supplies the two inputs
 * coachingAdjustmentContinuous needs:
 *
 *   newHc     did the head coach change from last season?
 *   overPerf  how much did this coach's PREVIOUS teams beat the baseline of
 *             the programs he was running, in SP+ points?
 *
 * Why over-performance vs the program rather than raw record: a coach who went
 * 9-3 at Alabama and a coach who went 9-3 at Kansas did not do the same job.
 * Measuring each of his seasons against what that school looks like under
 * everyone else implicitly adjusts for the talent he inherited.
 *
 * Point-in-time safety: overPerf for season Y reads only seasons strictly
 * before Y, so the backtest can't see a coach's future when rating his hire.
 */

import type { CfbdCoach } from "../../src/lib/cfbd";

export interface CoachSeason {
  coach: string;
  school: string;
  year: number;
  games: number;
  /** SP+ overall, centered on that season's league mean (removes scale drift) */
  centered: number | null;
}

export interface CoachTransition {
  school: string;
  newHc: boolean;
  /** null when the incoming coach has no prior head-coaching seasons */
  overPerf: number | null;
  coach: string | null;
  previousCoach: string | null;
}

/** CFBD has shipped both camelCase and snake_case on this endpoint. */
function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function coachName(c: CfbdCoach): string {
  const raw = c as unknown as Record<string, unknown>;
  const first = (pick(raw, "firstName", "first_name") as string) ?? "";
  const last = (pick(raw, "lastName", "last_name") as string) ?? "";
  return `${first} ${last}`.trim();
}

/**
 * Flatten the nested CFBD response into one row per coach-season, with SP+
 * centered per year. Rows without a school/year are dropped.
 */
export function flattenCoachSeasons(coaches: CfbdCoach[]): CoachSeason[] {
  const raw: Array<{ coach: string; school: string; year: number; games: number; sp: number | null }> =
    [];

  for (const c of coaches) {
    const name = coachName(c);
    const seasons = (c.seasons ?? []) as unknown as Array<Record<string, unknown>>;
    for (const s of seasons) {
      const school = pick(s, "school") as string | null;
      const year = num(pick(s, "year"));
      if (!school || year === null) continue;
      raw.push({
        coach: name,
        school,
        year,
        games: num(pick(s, "games")) ?? 0,
        sp: num(pick(s, "spOverall", "sp_overall")),
      });
    }
  }

  // Center SP+ within each season: the rating scale drifts across years, and
  // an uncentered comparison would read that drift as coach quality.
  const byYear = new Map<number, number[]>();
  for (const r of raw) {
    if (r.sp === null) continue;
    const arr = byYear.get(r.year) ?? [];
    arr.push(r.sp);
    byYear.set(r.year, arr);
  }
  const yearMean = new Map<number, number>();
  for (const [year, vals] of byYear) {
    yearMean.set(year, vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  return raw.map((r) => ({
    coach: r.coach,
    school: r.school,
    year: r.year,
    games: r.games,
    centered: r.sp === null ? null : r.sp - (yearMean.get(r.year) ?? 0),
  }));
}

const key = (school: string, year: number) => `${school}|${year}`;

/**
 * Head coach of record per school-season: the coach who worked the most games.
 * Mid-season firings leave two coaches on one school-year; the one who
 * actually ran the team is the one the model should attribute it to.
 */
export function headCoachByTeamYear(seasons: CoachSeason[]): Map<string, string> {
  const best = new Map<string, { coach: string; games: number }>();
  for (const s of seasons) {
    const k = key(s.school, s.year);
    const cur = best.get(k);
    if (!cur || s.games > cur.games) best.set(k, { coach: s.coach, games: s.games });
  }
  return new Map([...best].map(([k, v]) => [k, v.coach]));
}

/**
 * What a program looks like WITHOUT this coach: the mean centered SP+ of its
 * other seasons. `excludeYears` is the coach's own tenure there, so a long
 * tenure doesn't end up being measured against itself.
 */
function programBaseline(
  schoolSeasons: CoachSeason[],
  excludeYears: Set<number>,
): number | null {
  const others = schoolSeasons.filter((s) => s.centered !== null && !excludeYears.has(s.year));
  if (others.length === 0) return null;
  return others.reduce((a, s) => a + (s.centered as number), 0) / others.length;
}

/**
 * Games-weighted mean of (this coach's season − that program's baseline) over
 * every head-coaching season strictly before `asOfYear`. null when he has no
 * prior seasons with an SP+ rating (a first-time head coach).
 */
export function coachOverPerformance(
  coach: string,
  asOfYear: number,
  seasons: CoachSeason[],
  headCoach: Map<string, string>,
): number | null {
  const his = seasons.filter(
    (s) =>
      s.coach === coach &&
      s.year < asOfYear &&
      s.centered !== null &&
      headCoach.get(key(s.school, s.year)) === coach,
  );
  if (his.length === 0) return null;

  const bySchool = new Map<string, CoachSeason[]>();
  for (const s of seasons) {
    const arr = bySchool.get(s.school) ?? [];
    arr.push(s);
    bySchool.set(s.school, arr);
  }
  const tenureAt = new Map<string, Set<number>>();
  for (const s of his) {
    const set = tenureAt.get(s.school) ?? new Set<number>();
    set.add(s.year);
    tenureAt.set(s.school, set);
  }

  let weight = 0;
  let acc = 0;
  for (const s of his) {
    const baseline = programBaseline(
      bySchool.get(s.school) ?? [],
      tenureAt.get(s.school) ?? new Set(),
    );
    if (baseline === null) continue;
    const w = Math.max(s.games, 1);
    acc += ((s.centered as number) - baseline) * w;
    weight += w;
  }
  return weight === 0 ? null : acc / weight;
}

/**
 * Head-coach transitions into `year`, keyed by school name.
 *
 * A school with no coach row for `year` (common for an upcoming season CFBD
 * hasn't populated) is reported as intact with coach=null rather than guessed
 * at — the caller logs those so a real gap is visible instead of silently
 * scoring every team as a new hire.
 */
export function buildCoachTransitions(coaches: CfbdCoach[], year: number): Map<string, CoachTransition> {
  const seasons = flattenCoachSeasons(coaches);
  const headCoach = headCoachByTeamYear(seasons);

  const schools = new Set(seasons.filter((s) => s.year === year || s.year === year - 1).map((s) => s.school));
  const out = new Map<string, CoachTransition>();

  for (const school of schools) {
    const now = headCoach.get(key(school, year)) ?? null;
    const prev = headCoach.get(key(school, year - 1)) ?? null;
    const newHc = now !== null && prev !== null && now !== prev;
    out.set(school, {
      school,
      newHc,
      overPerf: newHc && now ? coachOverPerformance(now, year, seasons, headCoach) : null,
      coach: now,
      previousCoach: prev,
    });
  }
  return out;
}

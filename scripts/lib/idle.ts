/**
 * Offseason idle guard for the polling jobs.
 *
 * The crons in .github/workflows/jobs.yml fire year-round, but line movement
 * on August 7th says nothing about a game on August 29th, and the Saturday
 * burst schedule spends a CFBD call every ten minutes even in June (the
 * `cfbd.lines()` fetch happens before the kick-window filter). Rather than
 * editing cron expressions every August and remembering to put them back in
 * December, each job asks "how far away is the next kickoff?" and no-ops when
 * the answer is far.
 *
 * The guard reads the games table, so it engages every offseason on its own
 * and releases the moment openers come into range.
 *
 * Overrides: --force on the command line or IDLE_OVERRIDE=1 in the
 * environment, so workflow_dispatch can always run a job by hand.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const DAY_MS = 24 * 3600 * 1000;

/**
 * Games that should have kicked but whose status hasn't flipped yet still
 * count as "now" — the same 6h grace fetchCurrentSlate uses (src/lib/season.ts),
 * so status lag can never be mistaken for an idle offseason.
 */
const LATE_START_GRACE_MS = 6 * 3600 * 1000;

export function idleOverridden(argv: string[] = process.argv): boolean {
  return argv.includes("--force") || process.env.IDLE_OVERRIDE === "1";
}

/** Env-tunable threshold in days, so cadence can change without a deploy. */
export function envDays(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * Milliseconds until the next kickoff of the season.
 *   0    — a game is live right now
 *   null — no remaining scheduled games (deep offseason, or nothing ingested)
 */
export async function msUntilNextGame(
  db: SupabaseClient,
  season: number,
  now: number = Date.now(),
): Promise<number | null> {
  const { data: live } = await db
    .from("games")
    .select("id")
    .eq("season_id", season)
    .eq("status", "in_progress")
    .limit(1);
  if ((live ?? []).length > 0) return 0;

  const cutoff = new Date(now - LATE_START_GRACE_MS).toISOString();
  const { data } = await db
    .from("games")
    .select("start_ts")
    .eq("season_id", season)
    .eq("status", "scheduled")
    .gte("start_ts", cutoff)
    .order("start_ts", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const startTs = (data as { start_ts: string | null } | null)?.start_ts;
  if (!startTs) return null;
  return Math.max(0, new Date(startTs).getTime() - now);
}

export interface IdleOptions {
  job: string;
  season: number;
  horizonDays: number;
  /**
   * What to do when the season has no scheduled games at all. Polling jobs
   * skip; sync-games must RUN — it is the job that populates the table, so
   * skipping would deadlock the bootstrap every new season.
   */
  whenNoGames?: "skip" | "run";
  now?: number;
}

/**
 * True when the job should return without doing any work. Logs a structured
 * one-liner on every skip so an Actions run always says why it did nothing.
 */
export async function idleSkip(db: SupabaseClient, opts: IdleOptions): Promise<boolean> {
  if (idleOverridden()) return false;

  const now = opts.now ?? Date.now();
  const ms = await msUntilNextGame(db, opts.season, now);

  if (ms === null) {
    const skip = (opts.whenNoGames ?? "skip") === "skip";
    console.log(
      JSON.stringify({
        job: opts.job,
        season: opts.season,
        [skip ? "skipped" : "proceeding"]: "no_scheduled_games",
      }),
    );
    return skip;
  }

  const days = ms / DAY_MS;
  if (days <= opts.horizonDays) return false;

  console.log(
    JSON.stringify({
      job: opts.job,
      season: opts.season,
      skipped: `next_game_gt_${opts.horizonDays}d`,
      days_to_kickoff: Math.round(days * 10) / 10,
      next_kickoff: new Date(now + ms).toISOString(),
    }),
  );
  return true;
}

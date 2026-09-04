/**
 * Shared job implementations (docs/SPEC.md §8), used by the thin CLI wrappers
 * in scripts/ and scheduled via GitHub Actions.
 *
 * This is the only implementation. A second copy lived in
 * supabase/functions/jobs/ as the future pg_cron path and was deleted on
 * 2026-08-13 — never deployed, four model versions behind this file, and
 * carrying inverted CLV in all four of its branches. A tombstone with a live
 * bug in it is worse than no tombstone; git has it if it is ever wanted.
 */

import { rmSync, writeFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cfbd, type CfbdScoreboardGame } from "../../src/lib/cfbd";
import {
  espn,
  nflStoredWeek,
  parseEvent,
  parseScoringPlays,
  pointsCovered,
  type ScoringPlay,
} from "../../src/lib/espn";
import { nflTeamId, seasonIdsForYear, seasonYearOf } from "../../src/lib/league";
import { cfbdScoringOffense, cfbdScoringPlays } from "../../src/lib/scoring";
import { modelClv, roundClv, spreadClv, totalClv } from "../../src/lib/clv";
import { consensusFromSnapshots, SNAPSHOT_COLS } from "../../src/lib/consensus";
import { pageAll } from "../../src/lib/page-all";
import { clockToSeconds, coverMargin, spreadCoverSide, totalCoverSide } from "../../src/lib/cover";
import {
  firstHalfScore,
  gradePick,
  gradeTeamTotal,
  type HalfScore,
  type PickMarket,
} from "../../src/lib/grade";
import { keepLastPlay } from "../../src/lib/live-play";
import { notifyBadBeats, notifyWatchdog, type FlipNotice } from "./notify-jobs";
import { buildTeamNameIndex } from "../../src/lib/rankings";
import { fetchCurrentSlate } from "../../src/lib/season";
import { fcsRatingOf, fcsTopIds } from "../../src/model/fcs";
import { isDeadStatus, voidWagersForGames } from "../../src/lib/void";
import {
  DEFAULT_PARAMS,
  MODEL_VERSION,
  blendWithPrior,
  paramsForWeek,
  priceGame,
  priorWeight,
  splitInformative,
  updateSubRatings,
  type TeamRating,
} from "../../src/model/ratings";
import { envNum } from "./env-num";
import { DAY_MS, envDays, idleOverridden } from "./idle";

export const SEASON = envNum("CFB_SEASON", 2026, { min: 2000, max: 2100 });
/**
 * The FCS bucket set, read back from `teams.fcs_avg_margin` (0035) and split at
 * the median by the same `fcsTopIds` the backtest fits with, so the served rule
 * and the fitted rule cannot diverge.
 *
 * Empty until `build-preseason` has written the column, and empty means every
 * FCS opponent prices at `fcsOtherRating` — which, while both buckets sit at
 * −30, is exactly the flat anchor every prior version used.
 */
async function loadFcsTop(db: SupabaseClient): Promise<ReadonlySet<number>> {
  const { data } = await db
    .from("teams")
    .select("id, fcs_avg_margin")
    .not("fcs_avg_margin", "is", null);
  const margins = new Map(
    ((data ?? []) as Array<{ id: number; fcs_avg_margin: number }>).map((t) => [
      t.id,
      // n is not stored: build-preseason already applied the minimum-games
      // filter before writing, so a row here is by definition qualified.
      { avgMargin: Number(t.fcs_avg_margin), n: Number.POSITIVE_INFINITY },
    ]),
  );
  return fcsTopIds(margins);
}

type Json = Record<string, unknown>;

// Current slate derived from kickoffs (src/lib/season.ts) — the old
// min-scheduled-week query here could be pinned forever by one postponed-and-
// rescheduled early-season game (audit bug #8).

interface Snapshot {
  game_id: number;
  provider: string;
  spread: number | null;
  /** Only selected where the opener is needed; consensus falls back to `spread`. */
  spread_open?: number | null;
  total: number | null;
  captured_at: string;
}

/**
 * The columns every consensus read needs.
 *
 * `spread_open` matters and is easy to lose: `consensusFromSnapshots` computes
 * `open` as `spread_open ?? spread`, so a select that omits the column doesn't
 * error — it silently reports the current line as the opener, and every
 * prediction's `open_spread` becomes a copy of `vegas_spread`. Exported so a
 * test can hold the column list to that.
 */
/* One definition, in src/lib/consensus.ts beside the function that reads
   these columns. Re-exported under the name jobs-core has always used, which
   is what jobs-core.test.ts asserts on. */
export { SNAPSHOT_COLS };

/** Shared consensus (src/lib/consensus.ts) — no more drift between the jobs'
 *  copy and the app's copy (audit #43). */
const consensus = (snapshots: Snapshot[], before?: string) =>
  consensusFromSnapshots(snapshots, before);

/**
 * A close only counts as a close if somebody captured it near kickoff. With
 * one close pass per kickoff wave (jobs.yml) the last pre-kick snapshot is
 * normally under an hour old; if the pass missed — cron skipped, kickoff moved,
 * TBD start — the newest pre-kick snapshot might be Tuesday's, and grading CLV
 * against Tuesday's line produces a plausible-looking wrong number that is
 * worse than no number. So a close older than STALE_CLOSE_MS at kickoff nulls
 * the priced fields: results still grade (they read the line *taken*, not the
 * close) and CLV stays null in the ungraded set, exactly like a game with no
 * snapshots at all.
 */
export const STALE_CLOSE_MS = 6 * 3600 * 1000;
export function closingConsensus(
  snapshots: Snapshot[],
  startTs: string | null,
  maxAgeMs: number = STALE_CLOSE_MS,
): ReturnType<typeof consensusFromSnapshots> {
  const c = consensusFromSnapshots(snapshots, startTs ?? undefined);
  // Unknown kickoff = no close. With no `before` cutoff the newest snapshot
  // wins, which for a TBD-then-played game can be one captured AFTER the
  // game — a post-hoc line graded as "the close" (audit 05/N6).
  if (startTs === null)
    return { ...c, spread: null, total: null, mlHome: null, mlAway: null };
  const kick = Date.parse(startTs);
  let newest = -Infinity;
  for (const s of snapshots) {
    const t = Date.parse(s.captured_at);
    if (t < kick && t > newest) newest = t;
  }
  if (kick - newest > maxAgeMs) return { ...c, spread: null, total: null, mlHome: null, mlAway: null };
  return c;
}

/**
 * OPS-4b, 2026-08-20. Where a run publishes its `job_runs` id so that a LATER
 * WORKFLOW STEP can settle the row when the runner cancels this one.
 *
 * The signal handler in `recordJobRun` cannot do it, which the fix on 08-19
 * assumed it could. Run 32329026607's log shows why: cancelling kills the
 * step's bash shell, and the job is complete 0.26 s later, after the runner
 * prints `Terminate orphan process` for the whole `npm exec tsx → sh → node →
 * node` tree. The signal never reaches the grandchild that installed the
 * handler, and a Supabase round-trip would not finish inside a quarter second
 * if it had. A step guarded by `if: cancelled()` runs *after* all that — the
 * same log shows the post-checkout step executing — so it is the one place
 * with both the time and a live process to write from.
 *
 * Unset outside Actions, where the handler is the thing that works: a local
 * Ctrl-C reaches the process directly and settles its own row.
 */
function publishRunId(runId: number | null): void {
  const path = process.env.JOB_RUN_ID_FILE;
  if (!path || runId === null) return;
  try {
    writeFileSync(path, String(runId));
  } catch {
    /* observability must never break the thing it observes */
  }
}

/** Drop the pointer once the row has settled itself, so a cancellation
 *  arriving between two jobs in a chained step has nothing stale to point at.
 *  The status guard in `settleCanceledRun` is the real protection; this keeps
 *  the step from doing pointless work. */
function clearRunId(): void {
  const path = process.env.JOB_RUN_ID_FILE;
  if (!path) return;
  try {
    rmSync(path, { force: true });
  } catch {
    /* same rule */
  }
}

/**
 * Settle a row the runner cancelled (OPS-4b). Called from the workflow's
 * `if: cancelled()` step via scripts/settle-canceled-run.ts, never from the
 * job itself.
 *
 * `finished_at` IS written here, unlike the thirteen rows 0073 swept: the
 * cancellation is being recorded as it happens by something that watched it,
 * so the timestamp is observed rather than fabricated.
 *
 * The `status = running` guard is what makes the step safe to run on any
 * cancellation: a job that finished normally in the seconds before the
 * cancellation landed keeps its `ok`, and a re-run of the step is a no-op.
 * A row still reading `running` after all this keeps the meaning OPS-4 gave
 * it — killed hard enough that nothing got a word in.
 */
export async function settleCanceledRun(
  db: SupabaseClient,
  runId: number,
  note: string,
): Promise<"settled" | "already-finished"> {
  const { data } = await db
    .from("job_runs")
    .update({ status: "canceled", finished_at: new Date().toISOString(), error: note })
    .eq("id", runId)
    .eq("status", "running")
    .select("id");
  return ((data as unknown[] | null) ?? []).length > 0 ? "settled" : "already-finished";
}

/**
 * Record one job run in job_runs (migration 0024): started/finished/status
 * plus the job's own summary JSON. The admin freshness card reads it, which
 * is the absence half of alerting — a run that errors is loud on its own; a
 * run that never happened is only visible as a missing row here.
 *
 * Observability must never break the thing it observes: if the bookkeeping
 * writes fail, the job still runs and the error still propagates.
 */
export async function recordJobRun<T extends Json>(
  db: SupabaseClient,
  job: string,
  fn: () => Promise<T>,
): Promise<T> {
  let runId: number | null = null;
  try {
    const { data } = await db.from("job_runs").insert({ job }).select("id").single();
    runId = (data as { id: number } | null)?.id ?? null;
  } catch {
    /* job_runs unavailable — run the job anyway */
  }
  publishRunId(runId);
  let settled = false;
  const finish = async (patch: Record<string, unknown>) => {
    if (runId === null || settled) return;
    settled = true;
    try {
      await db
        .from("job_runs")
        .update({ finished_at: new Date().toISOString(), ...patch })
        .eq("id", runId);
    } catch {
      /* same rule */
    }
  };

  /* OPS-4. The hourly scoreboard loops overlap by design and the workflow's
     concurrency group cancels the old one (jobs.yml, `cancel-in-progress`), so
     GitHub signals the process and neither branch below ever runs — the row
     stays `running` with a null `finished_at` forever. Thirteen of those had
     accumulated by 2026-08-19, one per hour of live football, and a healthy
     handoff was writing a row shaped exactly like a job that died.

     Recording the cancellation is the fix rather than sweeping stale rows
     later: it is the truth at the moment it happens, and it leaves a lingering
     `running` row meaning what it should — killed hard enough not to get a
     word in, which is worth seeing.

     OPS-4b, 2026-08-20: on GitHub this handler never fires, so it is the
     local-Ctrl-C path and a backstop rather than the fix. The workflow's
     `if: cancelled()` step is what settles a cancelled run — see
     `publishRunId` above for the evidence and the mechanism.

     Installing a listener overrides Node's default exit, so the handler must
     exit itself. `once` plus the `settled` flag keeps a second signal, or a
     signal racing a normal finish, from writing twice. */
  const cancelOn = (signal: "SIGINT" | "SIGTERM") => () =>
    void finish({ status: "canceled", error: `received ${signal}` }).finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  const onInt = cancelOn("SIGINT");
  const onTerm = cancelOn("SIGTERM");
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  const release = () => {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  };

  try {
    const result = await fn();
    await finish({ status: "ok", detail: result });
    return result;
  } catch (err) {
    await finish({ status: "error", error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    /* A long-lived process calls this more than once; leaving the listeners
       attached would leak one pair per call and eventually warn. */
    release();
    clearRunId();
  }
}

/**
 * In-repo dead-man's switch (audit 07/OPS-1c): reads job_runs and FAILS —
 * loudly, as a red Actions run — when an expected job hasn't succeeded inside
 * its cadence. This is the absence check: an erroring run is red on its own;
 * a cron that silently stops firing is only visible as a timestamp falling
 * behind. Chained onto the daily lines run, so it fires even if every other
 * schedule is broken — and if THAT cron dies too, the external ping
 * (HEALTHCHECK_PING_URL) is the last line.
 */
/**
 * The pure verdict: given the hours since each job last succeeded and whether
 * a game is live, which jobs have gone silent past their cadence. Separated
 * from the queries so the thresholds are testable without a database (the
 * scoreboardPatch/freezableGames pattern).
 */
export function watchdogVerdict(
  agesH: {
    refreshLines: number;
    syncGames: number;
    scoreboard: number;
    picksDue?: number;
    logBets?: number;
    /** NFL-22. Optional so a caller that omits them is simply not checked. */
    nflSyncGames?: number;
    nflRefreshLines?: number;
    nflLinesClose?: number;
    nflGrade?: number;
    /** R2-C2. Daily and unconditional — the run itself is what's checked. */
    streak?: number;
    /** R3-E2. Weekly AND seasonal, so it takes the notify-jobs horizon. */
    sixPack?: number;
    /** TAPE-2 et al. Daily and unconditional, like the streak. */
    dailyPuzzles?: number;
  },
  gameLive: boolean,
  /** Any scheduled game inside the next week. Gates the weekly notify jobs. */
  gamesThisWeek = false,
  /** LIVE-3. Minutes since either poller last pulled successfully; Infinity
   *  when neither ever has. Omitted by a caller = not checked, like the NFL
   *  lane above, so an older caller cannot be broken by this argument. */
  liveBeatMin?: number,
): string[] {
  const problems: string[] = [];
  if (agesH.refreshLines > 26)
    problems.push(`refresh-lines: no successful run in ${Math.round(agesH.refreshLines)}h`);
  if (agesH.syncGames > 30)
    problems.push(`sync-games: no successful run in ${Math.round(agesH.syncGames)}h`);
  // The streak's daily run is unconditional (dormant days still run and
  // select nothing), so its freshness check is too — same 30h slack as
  // sync-games for a daily cron. Omitted by a caller = not checked, like the
  // NFL lane. Infinity (never ran) is ALSO not checked, unlike the others:
  // a brand-new job's first cron hasn't come yet, and flagging the gap
  // between its deploy and its first firing would page someone over a state
  // that resolves itself within a day. Once it has run once, silence past
  // 30h is a real absence and trips normally.
  if (agesH.streak !== undefined && Number.isFinite(agesH.streak) && agesH.streak > 30)
    problems.push(`streak: no successful run in ${Math.round(agesH.streak)}h`);
  /* The lane Guess the Game could never have. Its puzzle was computed on read,
     so there was no job to be late and its empty deck went unnoticed for weeks
     (GTG-1). `daily-puzzles` banks a fortnight and fails below four days, so
     this horizon is the second line rather than the first — but a generator
     that stops running stops refilling, and the queue drains silently.
     Same Number.isFinite guard and same reasoning as the streak above. */
  if (
    agesH.dailyPuzzles !== undefined &&
    Number.isFinite(agesH.dailyPuzzles) &&
    agesH.dailyPuzzles > 30
  )
    problems.push(`daily-puzzles: no successful run in ${Math.round(agesH.dailyPuzzles)}h`);
  /* Scoreboard only owes freshness while something is actually on.
     LIVE-3, 2026-08-20: this used to read `agesH.scoreboard > 1.5` off a
     `status = 'ok'` run, and LIVE-2 broke that rule the day it shipped. Runs
     are four hours now and hourly launches cancel each other, so a cancelled
     run writes `canceled` and an `ok` row appears only when a loop survives
     its whole deadline — which on a game day it never does. The old rule would
     have paged every Saturday afternoon with nothing wrong, which is worse
     than not checking: an alarm that cries wolf gets muted, and this is the
     alarm for the live layer.
     What it asks now is whether anything actually POLLED, which is the
     question it always meant. Both pollers stamp `live_heartbeat`, so this is
     true whichever one is doing the work — and a game with no snaps for three
     minutes no longer looks like a dead pipeline. */
  if (gameLive && liveBeatMin !== undefined && liveBeatMin > 5)
    problems.push(
      `live scores: a game is LIVE and nothing has polled it in ${
        Number.isFinite(liveBeatMin) ? `${Math.round(liveBeatMin)}m` : "any recorded run"
      }`,
    );
  /* The launches themselves, at a horizon a healthy game day cannot trip.
     Distinct from the beat above: launches stopping means the scheduler is
     failing (LIVE-2's actual fault), while beats stopping means the feed is.
     Counting a cancelled or running launch is the point — those ARE launches,
     and after LIVE-2 they are the usual shape. */
  if (gameLive && agesH.scoreboard > 5)
    problems.push(
      `scoreboard-loop: a game is LIVE and no loop has launched in ${agesH.scoreboard.toFixed(1)}h`,
    );

  // The notify jobs are weekly AND seasonal, which is why they cannot use an
  // hours-since-last-run horizon like the others: from December to August they
  // are correctly silent, and a naive check would go red every week for eight
  // months until nobody read it any more. The gate is whether there is anything
  // to notify about — a scheduled game inside the next week. 8 days, not 7, so
  // a run that slips a day does not trip it.
  const WEEKLY = 8 * 24;
  if (gamesThisWeek && (agesH.picksDue ?? 0) > WEEKLY)
    problems.push(`notify-picks-due: games this week and no successful run in ${Math.round(agesH.picksDue!)}h`);
  if (gamesThisWeek && (agesH.logBets ?? 0) > WEEKLY)
    problems.push(`notify-log-bets: games this week and no successful run in ${Math.round(agesH.logBets!)}h`);
  // The Six-Pack is weekly and seasonal for the same reason the notify jobs
  // are: correctly silent from January to August, so an hours horizon would
  // go red every week for eight months until nobody read it. Never-run
  // (Infinity) is exempt like the streak's — a new job's first cron has not
  // come yet, and that gap closes itself.
  if (
    gamesThisWeek &&
    agesH.sixPack !== undefined &&
    Number.isFinite(agesH.sixPack) &&
    agesH.sixPack > WEEKLY
  )
    problems.push(`six-pack: games this week and no successful run in ${Math.round(agesH.sixPack)}h`);

  // The NFL lane (NFL-22). Until 2026-08-14 none of it was watched at all, so
  // any of these could stop and nothing would go red.
  //
  // These get plain hour horizons where the notify jobs above could not, and
  // the reason is worth stating: both NFL ingest jobs are *chained onto their
  // CFB counterparts* in the `Run job` case, so they fire daily all year and
  // there is no eight-month offseason silence to tolerate. `nfl-grade` and
  // `nfl-lines-close` have crons of their own whose widest gap is 72 hours
  // (Fri→Mon for grading, Mon→Thu for the close pass), so 80 leaves room for
  // Actions' 5–30 minute lag without blunting the check. Both jobs record an
  // `ok` run when they no-op — `{"skipped": "no_kicks_in_window"}` is still a
  // success — which is what makes an absence check meaningful for them.
  const NFL_MULTI_DAY = 80;
  if ((agesH.nflSyncGames ?? 0) > 30)
    problems.push(`nfl-sync-games: no successful run in ${Math.round(agesH.nflSyncGames!)}h`);
  if ((agesH.nflRefreshLines ?? 0) > 26)
    problems.push(`nfl-refresh-lines: no successful run in ${Math.round(agesH.nflRefreshLines!)}h`);
  if ((agesH.nflLinesClose ?? 0) > NFL_MULTI_DAY)
    problems.push(`nfl-lines-close: no successful run in ${Math.round(agesH.nflLinesClose!)}h`);
  if ((agesH.nflGrade ?? 0) > NFL_MULTI_DAY)
    problems.push(`nfl-grade: no successful run in ${Math.round(agesH.nflGrade!)}h`);

  return problems;
}

export async function watchdogJob(db: SupabaseClient): Promise<Json> {
  const now = Date.now();
  /* LIVE-3. Any launch, whatever became of it — `ok`, `canceled` or still
     `running`. The scoreboard rule needs "did the scheduler fire", and since
     LIVE-2 the healthy shape of a game-day launch is `canceled` (the next
     hourly launch replaced it) or `running` (it still is). Only the scoreboard
     check uses this; every other job below is genuinely asking whether a run
     SUCCEEDED, and keeps `lastOkAgeH`. */
  const lastLaunchAgeH = async (job: string): Promise<number> => {
    const { data } = await db
      .from("job_runs")
      .select("started_at")
      .eq("job", job)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? (now - Date.parse((data as { started_at: string }).started_at)) / 3600_000 : Infinity;
  };
  const lastOkAgeH = async (job: string): Promise<number> => {
    const { data } = await db
      .from("job_runs")
      .select("started_at")
      .eq("job", job)
      .eq("status", "ok")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? (now - Date.parse((data as { started_at: string }).started_at)) / 3600_000 : Infinity;
  };
  // BOTH leagues (NFL-22). These two gates were `.eq("season_id", SEASON)` —
  // CFB only — until 2026-08-14, and that was the expensive half of the NFL
  // blind spot. The scoreboard freshness check below only arms when a game is
  // live, so a CFB-only gate meant the check that exists to catch a dead live
  // layer was switched off for the entire NFL preseason (the only football
  // being played at the time) and would have been off again for every NFL-only
  // Sunday of the autumn. `seasonIdsForYear` is the existing helper for exactly
  // this read — one year, both leagues.
  const seasons = seasonIdsForYear(SEASON);
  const { data: live } = await db
    .from("games")
    .select("id")
    .in("season_id", seasons)
    .eq("status", "in_progress")
    .limit(1);

  const { data: upcoming } = await db
    .from("games")
    .select("id")
    .in("season_id", seasons)
    .gte("start_ts", new Date(now).toISOString())
    .lte("start_ts", new Date(now + 7 * 24 * 3600_000).toISOString())
    .limit(1);

  const problems = watchdogVerdict(
    {
      refreshLines: await lastOkAgeH("refresh-lines"),
      syncGames: await lastOkAgeH("sync-games"),
      scoreboard: await lastLaunchAgeH("scoreboard-loop"),
      picksDue: await lastOkAgeH("notify-picks-due"),
      logBets: await lastOkAgeH("notify-log-bets"),
      nflSyncGames: await lastOkAgeH("nfl-sync-games"),
      nflRefreshLines: await lastOkAgeH("nfl-refresh-lines"),
      nflLinesClose: await lastOkAgeH("nfl-lines-close"),
      nflGrade: await lastOkAgeH("nfl-grade"),
      streak: await lastOkAgeH("streak"),
      sixPack: await lastOkAgeH("six-pack"),
      dailyPuzzles: await lastOkAgeH("daily-puzzles"),
    },
    (live ?? []).length > 0,
    (upcoming ?? []).length > 0,
    /* Whichever poller pulled most recently. Either one keeps the card fresh,
       so the alarm is about both being silent, not about which is working. */
    Math.min(
      await beatAgeMin(db, HEARTBEAT_SOURCES.loop),
      await beatAgeMin(db, HEARTBEAT_SOURCES.edge),
    ),
  );
  if (problems.length > 0) {
    // Buzz a phone before going red (OPS-2). The throw below is still what
    // makes the run fail and sends GitHub's email — this is an additional
    // channel, added because that email arrives and does not get read: on
    // 2026-08-13 the Aug 10 watchdog failure was found in the inbox unread,
    // along with eight others. `notifyWatchdog` swallows its own errors, so a
    // push failure can never replace the real fault with its own.
    await notifyWatchdog(db, problems);
    throw new Error(`watchdog: ${problems.join("; ")}`);
  }
  return {
    checked: [
      "refresh-lines",
      "sync-games",
      "scoreboard-loop",
      "notify-picks-due",
      "notify-log-bets",
      "nfl-sync-games",
      "nfl-refresh-lines",
      "nfl-lines-close",
      "nfl-grade",
    ],
    // Reported so `job_runs.detail` says which league the liveness gate was
    // reading. Before NFL-22 it silently said "CFB" and looked identical.
    leagues: seasons,
    ok: true,
  };
}

/**
 * Meter CFBD usage into api_call_log (one row per call — the table existed
 * since 0001 but nothing ever wrote it). The scoreboard loop throttles and
 * stops off this table, and the Crew admin panel shows the month's total.
 */
export async function logApiCalls(
  db: SupabaseClient,
  job: string,
  calls: number,
  source: string,
): Promise<void> {
  if (calls <= 0) return;
  const rows = Array.from({ length: calls }, () => ({ source, endpoint: job }));
  const { error } = await db.from("api_call_log").insert(rows);
  if (error) console.error(`api_call_log insert failed: ${error.message}`);
}

export async function logCfbdCalls(
  db: SupabaseClient,
  job: string,
  calls: number,
): Promise<void> {
  return logApiCalls(db, job, calls, "cfbd");
}

/**
 * LIVE-3. Stamp "this poller just pulled successfully", whether or not the
 * pull changed anything.
 *
 * `job_runs` cannot answer that any more. Since LIVE-2 a loop runs four hours
 * and hourly launches cancel each other, so a `status = 'ok'` row appears only
 * when a run survives its whole deadline — which on a game day it never does.
 * And the games table cannot answer it either: a game with no snaps for three
 * minutes looks exactly like a pipeline that died three minutes ago.
 *
 * Never throws. Observability must not cost the thing it observes — the same
 * posture `recordJobRun` and `logApiCalls` take.
 */
export const HEARTBEAT_SOURCES = {
  /** The Actions loop, one beat per successful poll tick. */
  loop: "actions-loop",
  /** The 10-second pg_cron → edge function path (0044). */
  edge: "edge-10s",
} as const;

export async function beat(
  db: SupabaseClient,
  source: string,
  detail?: Json,
): Promise<void> {
  try {
    const { error } = await db
      .from("live_heartbeat")
      .upsert(
        { source, beat_at: new Date().toISOString(), detail: detail ?? null },
        { onConflict: "source" },
      );
    if (error) console.error(`live_heartbeat upsert failed: ${error.message}`);
  } catch (err) {
    console.error(`live_heartbeat upsert threw: ${err instanceof Error ? err.message : err}`);
  }
}

/** Minutes since a source last beat; Infinity when it never has. */
export async function beatAgeMin(db: SupabaseClient, source: string): Promise<number> {
  const { data } = await db
    .from("live_heartbeat")
    .select("beat_at")
    .eq("source", source)
    .maybeSingle();
  if (!data) return Infinity;
  return (Date.now() - Date.parse((data as { beat_at: string }).beat_at)) / 60_000;
}

/** ESPN is free and unauthenticated, but an unmetered loop is invisible in
 *  /admin — so its calls land in api_call_log like every other feed's. */
export async function logEspnCalls(
  db: SupabaseClient,
  job: string,
  calls: number,
): Promise<void> {
  return logApiCalls(db, job, calls, "espn");
}

// ---------------------------------------------------------------------------

/** The games columns the scoreboard poll owns, as stored. */
export interface ScoreboardRow {
  id: number;
  status: string;
  /** LIVE-4. Not in SCOREBOARD_COLS — see the note there. */
  last_play_at?: string | null;
  home_points: number | null;
  away_points: number | null;
  current_period: number | null;
  current_clock: string | null;
  current_situation: string | null;
  last_play: string | null;
  possession: string | null;
  tv: string | null;
  // Not part of the diff — carried so a detected cover flip can be stamped
  // with its season and week without a second read (0026).
  season_id: number;
  week: number;
}

// scoreboardPatch compares PATCH keys, so the two extra columns here are inert
// to the diff and only ride along for the flip rows.
export const SCOREBOARD_COLS =
  "id, status, home_points, away_points, current_period, current_clock, current_situation, last_play, possession, tv, season_id, week";
/* `last_play_at` is deliberately NOT selected here. The diff below compares
   every key of the patch against the stored row, and the patch carries a
   stamp only on the ticks where the play already changed — so the write is
   decided before the stamp exists and reading the old value would buy
   nothing. Selecting it would also invite the opposite bug: a stamp in the
   comparison makes every tick look different, and every tick would write. */

/**
 * The UPDATE a scoreboard game implies, or null when the stored row already
 * says all of it. The null matters: every games UPDATE fans out as a realtime
 * message to every connected client, and an unconditional write loop re-wrote
 * every final unchanged each 30s tick — by the evening slate, finished games
 * were most of the message volume, spent broadcasting nothing.
 */
export function scoreboardPatch(
  g: CfbdScoreboardGame,
  stored: ScoreboardRow | undefined,
  /** LIVE-4's clock, injected so the stamp is testable. */
  now: string = new Date().toISOString(),
): Partial<ScoreboardRow> | null {
  const status =
    g.status === "in_progress" ? "in_progress" : g.status === "completed" ? "final" : "scheduled";
  if (status === "scheduled") return null;
  const inProgress = status === "in_progress";
  const patch = {
    status,
    home_points: g.homeTeam.points,
    away_points: g.awayTeam.points,
    current_period: g.period,
    current_clock: g.clock,
    // nulled once final so finished games never show a stale down-and-distance
    current_situation: inProgress ? g.situation : null,
    /* A TV timeout is not a play, and it must not erase the one that is.
       Almost every score is followed straight away by one, so the plays this
       used to overwrite were the field goal, the extra point and the
       touchdown — the only ones anybody was reading. Keeping the stored value
       also means the diff below sees no change, so nothing fans out over
       realtime for a play that did not happen. */
    last_play: inProgress ? keepLastPlay(g.lastPlay, stored?.last_play, g.lastPlayType) : null,
    possession:
      inProgress && (g.possession === "home" || g.possession === "away") ? g.possession : null,
    // null TV from the board never clobbers a stored assignment
    tv: g.tv ?? stored?.tv ?? null,
  };
  if (stored && (Object.keys(patch) as Array<keyof typeof patch>).every((k) => stored[k] === patch[k]))
    return null;
  /* LIVE-4. Stamped AFTER the diff decision, never as part of it: the age of a
     play must not be able to cause a write, or every tick would write one and
     realtime would fan out a "change" that is only a clock.
     Set only when the play is new, so a kept play (the timeout rule above)
     keeps the time it actually arrived. Null stays null — a play we never
     watched arrive has no honest timestamp, and the card shows no age rather
     than inventing one. */
  if (patch.last_play && patch.last_play !== stored?.last_play)
    (patch as Partial<ScoreboardRow>).last_play_at = now;
  return patch;
}

/** One detected cover flip, ready to insert into `cover_flips` (0026). */
/** Flips written this tick, held for the push pass after the loop. */
export interface CoverFlip {
  market: "spread" | "total";
  line: number;
  from_side: string;
  to_side: string;
  home_points: number;
  away_points: number;
  prev_home_points: number;
  prev_away_points: number;
  period: number | null;
  clock: string | null;
  seconds_left: number | null;
  last_play: string | null;
  winner_changed: boolean;
}

/**
 * Bad beats and backdoor covers: did this scoring play flip who's covering?
 *
 * Pure, so the thresholds are testable without a database — the same shape as
 * `scoreboardPatch` and `freezableGames`. Only fires from the 4th quarter on
 * (`period >= 4` also catches overtime), and only when the score actually
 * moved, which is what makes a re-run a no-op: after the write, prev === next.
 *
 * KNOWN LIMIT: two scores inside one 30s tick collapse into one transition. A
 * score at 1:00 answered at 0:40 reads as the net move, and if the net cover
 * side is unchanged nothing is logged. Rare (onside kick and score), real, and
 * better stated here than rediscovered in November.
 */
export function detectCoverFlips(
  prev: { home_points: number | null; away_points: number | null },
  next: {
    homePoints: number | null;
    awayPoints: number | null;
    period: number | null;
    clock: string | null;
    lastPlay: string | null;
  },
  lines: { spread: number | null; total: number | null },
  lateFromPeriod = 4,
): CoverFlip[] {
  const { homePoints: h, awayPoints: a, period } = next;
  const ph = prev.home_points;
  const pa = prev.away_points;
  if (h === null || a === null || ph === null || pa === null) return [];
  if (h === ph && a === pa) return []; // nothing scored — nothing to flip
  if (period === null || period < lateFromPeriod) return [];

  const base = {
    home_points: h,
    away_points: a,
    prev_home_points: ph,
    prev_away_points: pa,
    period,
    clock: next.clock,
    seconds_left: clockToSeconds(next.clock),
    last_play: next.lastPlay,
    // A true backdoor leaves the winner alone and only moves the cover.
    winner_changed: Math.sign(ph - pa) !== Math.sign(h - a),
  };

  const flips: CoverFlip[] = [];
  if (lines.spread !== null) {
    const from = spreadCoverSide(lines.spread, ph, pa);
    const to = spreadCoverSide(lines.spread, h, a);
    if (from !== to)
      flips.push({ ...base, market: "spread", line: lines.spread, from_side: from, to_side: to });
  }
  if (lines.total !== null) {
    const from = totalCoverSide(lines.total, ph, pa);
    const to = totalCoverSide(lines.total, h, a);
    if (from !== to)
      flips.push({ ...base, market: "total", line: lines.total, from_side: from, to_side: to });
  }
  return flips;
}

/** Live scoreboard poll → games status/points/period/clock (slate live states). */
export async function scoreboardJob(db: SupabaseClient): Promise<Json> {
  const board = await cfbd.scoreboard();
  return applyScoreboard(db, board);
}

/**
 * The NFL half of the live layer: ESPN's current board, adapted into the same
 * shape and pushed through the same machinery — diffed writes, cover flips,
 * bad-beat pushes all included. Events outside the stored calendar (preseason,
 * Pro Bowl, TBD playoff slots) are dropped before they can touch the table.
 */
export async function nflScoreboardJob(db: SupabaseClient): Promise<Json> {
  const board = await espn.scoreboard();
  const adapted = (board.events ?? [])
    .map(parseEvent)
    .filter((g) => nflStoredWeek(g.espnSeasonType, g.espnWeek, g.name) !== null)
    .filter((g) => g.homeEspnId > 0 && g.awayEspnId > 0)
    .map(
      (g): CfbdScoreboardGame => ({
        id: g.id,
        startDate: g.startDate,
        status: g.status === "final" ? "completed" : g.status,
        period: g.period,
        clock: g.clock,
        situation: g.situation,
        lastPlay: g.lastPlay,
        lastPlayType: g.lastPlayType,
        possession: g.possession,
        homeTeam: { id: nflTeamId(g.homeEspnId), name: g.homeAbbr ?? "", points: g.homePoints },
        awayTeam: { id: nflTeamId(g.awayEspnId), name: g.awayAbbr ?? "", points: g.awayPoints },
        tv: g.tv,
      }),
    );
  return applyScoreboard(db, adapted);
}

/** The write half both boards share: diff against stored, flip, patch, notify. */
export async function applyScoreboard(
  db: SupabaseClient,
  board: CfbdScoreboardGame[],
): Promise<Json> {
  const active = board.filter((g) => g.status === "in_progress" || g.status === "completed");
  if (active.length === 0) return { live_or_final: 0, updated: 0 };

  // one read of what's stored, so unchanged games cost zero writes
  const { data: storedRows, error } = await db
    .from("games")
    .select(SCOREBOARD_COLS)
    .in("id", active.map((g) => g.id));
  if (error) throw new Error(`scoreboard: reading stored rows failed: ${error.message}`);
  const stored = new Map((storedRows as ScoreboardRow[] | null)?.map((r) => [r.id, r]) ?? []);

  // Bad-beat detection needs the number the game is being measured against,
  // but only for games that are actually late — so most ticks skip this read
  // entirely, and a 4th-quarter tick pays one narrow round trip (and zero
  // CFBD calls; lines come from line_snapshots via refresh-lines).
  const lateIds = active.filter((g) => (g.period ?? 0) >= 4).map((g) => g.id);
  const linesByGame = new Map<number, { spread: number | null; total: number | null }>();
  if (lateIds.length > 0) {
    const { data: lineRows } = await db
      .from("line_consensus")
      .select("game_id, spread, total")
      .in("game_id", lateIds);
    for (const r of (lineRows ?? []) as Array<{
      game_id: number;
      spread: number | null;
      total: number | null;
    }>) {
      linesByGame.set(r.game_id, {
        spread: r.spread === null ? null : Number(r.spread),
        total: r.total === null ? null : Number(r.total),
      });
    }
  }

  let updated = 0;
  let flipsLogged = 0;
  const pendingNotices: FlipNotice[] = [];
  for (const g of active) {
    const before = stored.get(g.id);
    const patch = scoreboardPatch(g, before);
    if (!patch) continue;

    // Detect BEFORE the write — `before` is the only copy of the pre-tick
    // score, and `g.lastPlay` is the only copy of what just happened (the
    // patch nulls last_play the moment a game goes final).
    const lines = linesByGame.get(g.id);
    if (before && lines) {
      const flips = detectCoverFlips(
        before,
        {
          homePoints: g.homeTeam.points,
          awayPoints: g.awayTeam.points,
          period: g.period,
          clock: g.clock,
          lastPlay: g.lastPlay,
        },
        lines,
      );
      for (const f of flips) {
        const { error: flipErr } = await db.from("cover_flips").insert({
          game_id: g.id,
          season_id: before.season_id,
          week: before.week,
          ...f,
        });
        // 23505 = the (game_id, market, score) unique key doing its job on a
        // retried tick. Anything else is worth knowing about, but never worth
        // failing the scoreboard poll over.
        if (!flipErr) {
          flipsLogged++;
          // Only a first-time insert notifies: on a retried tick the unique key
          // above already swallowed the duplicate, so this cannot double-send
          // even before sendToUser's own dedupe gets involved.
          pendingNotices.push({
            game_id: g.id,
            market: f.market,
            to_side: f.to_side,
            home_points: f.home_points,
            away_points: f.away_points,
            period: f.period ?? null,
            clock: f.clock ?? null,
          });
        } else if (flipErr.code !== "23505")
          console.error(`cover_flips insert failed for game ${g.id}: ${flipErr.message}`);
      }
    }

    const { data: touched } = await db.from("games").update(patch).eq("id", g.id).select("id");
    if (touched && touched.length > 0) updated++;
  }

  // Sending happens after the loop, not inside it: a poll that has already
  // written its scores should be finished writing them before it starts
  // talking to Apple. notifyBadBeats never throws — see notify-jobs.ts.
  const pushed = await notifyBadBeats(db, pendingNotices);

  // Settle whatever is finished on this board (GRADE-1). Before this, grading
  // was scheduled-only — Sunday 13:00 UTC for CFB, Mon/Tue/Fri for the NFL —
  // so a bet on a Saturday-night final stayed open on the ledger for days and
  // the card had no result to show.
  //
  // Deliberately NOT gated on a status transition, even though `stored` makes
  // one cheap to detect. The NFL's 10-second edge-function writer (migration
  // 0044) can flip a game to final before this loop's next tick, and a
  // transition-only trigger would then never fire for the league this was
  // reported on. Every completed game on the board is offered instead, and
  // `gradeGames` is idempotent — its queries all filter `result is null`, so
  // the second and every later tick settle nothing and read almost nothing.
  //
  // Errors are swallowed on purpose: the scoreboard's job is scores, and a
  // grading failure must not cost the slate its live layer. The scheduled pass
  // is still the backstop and will report the same failure loudly.
  const completedIds = active.filter((g) => g.status === "completed").map((g) => g.id);
  let settled: Json | null = null;
  try {
    if (completedIds.length > 0) settled = await gradeGames(db, completedIds);
  } catch (err) {
    console.error(`scoreboard: inline grading failed: ${(err as Error).message}`);
  }
  const gradedCounts = settled as {
    picksGraded: number;
    betsGraded: number;
    predictionsGraded: number;
  } | null;
  const gradedAnything =
    gradedCounts !== null &&
    (gradedCounts.picksGraded > 0 ||
      gradedCounts.betsGraded > 0 ||
      gradedCounts.predictionsGraded > 0);

  return {
    live_or_final: active.length,
    updated,
    flips: flipsLogged,
    ...(pushed.notified || pushed.errors ? { notified: pushed.notified, notify_errors: pushed.errors } : {}),
    // Only when it did something: a tick that grades nothing is the normal
    // case and should not add noise to every `job_runs.detail` row.
    ...(gradedAnything ? { graded: gradedCounts } : {}),
  };
}

/**
 * Daily poll sync: AP / Coaches / CFP committee ranks (display-only context;
 * never fed to the model). CFBD returns school names, so rows that don't
 * match teams.school or teams.alt_names are reported for repair via alt_names.
 */
/**
 * One season's poll rows. Parameterised out of `syncRankingsJob` when the
 * archive backfill needed the same work for 2015–22 (BF-3): the alternative
 * was a second copy of the name-index build and the KEEP set in
 * `scripts/lib/backfill.ts`, and a second copy of a name-matching loop is
 * exactly the drift this file's neighbours keep warning about.
 */
export async function syncRankingsFor(db: SupabaseClient, seasonId: number): Promise<Json> {
  const KEEP = new Set(["AP Top 25", "Coaches Poll", "Playoff Committee Rankings"]);
  const weeks = await cfbd.rankings(seasonId);
  const { data: teamRows } = await db.from("teams").select("id, school, alt_names");
  const nameIndex = buildTeamNameIndex(
    (teamRows ?? []) as Array<{ id: number; school: string; alt_names: string[] | null }>,
  );

  const rows: Json[] = [];
  const unmatched = new Set<string>();
  for (const wk of weeks) {
    for (const poll of wk.polls) {
      if (!KEEP.has(poll.poll)) continue;
      for (const r of poll.ranks) {
        const teamId = nameIndex.get(r.school.toLowerCase());
        if (teamId === undefined) {
          unmatched.add(r.school);
          continue;
        }
        rows.push({
          season_id: wk.season,
          week: wk.week,
          season_type: wk.seasonType,
          poll: poll.poll,
          team_id: teamId,
          rank: r.rank,
          points: r.points,
          first_place_votes: r.firstPlaceVotes,
          fetched_at: new Date().toISOString(),
        });
      }
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("poll_rankings").upsert(rows.slice(i, i + 500), {
      onConflict: "season_id,season_type,week,poll,team_id",
    });
    if (error) throw new Error(error.message);
  }
  return { rows: rows.length, unmatched: [...unmatched] };
}

export const syncRankingsJob = (db: SupabaseClient): Promise<Json> =>
  syncRankingsFor(db, SEASON);

/**
 * Weekly SP+ / FPI / Elo snapshot → system_ratings (spec §2.4). Persisted so
 * the freeze job can compute a real consensus flag and the game page can show
 * the systems side by side — both previously impossible (audit #28).
 */
export async function syncSystemsJob(db: SupabaseClient): Promise<Json> {
  const { week } = await fetchCurrentSlate(db, SEASON);
  const [sp, fpi, elo, { data: teamRows }] = await Promise.all([
    cfbd.spRatings(SEASON),
    cfbd.fpiRatings(SEASON),
    /* SYS-1. `/ratings/elo` with no week returned nothing for a season with no
       games played, and had done since this job was written — `system_ratings`
       has never held an Elo row, in any season. Elo is a running rating, so a
       seasonal query has nothing to average until games exist; asking for week
       1 gets the carry-in from last season, which is exactly the preseason
       number the consensus flag wants.
       Ordered rather than either/or: the seasonal call stays first because it
       is right once the season is under way, and the week-1 fallback only runs
       when it came back empty. */
    cfbd
      .eloRatings(SEASON)
      .then(async (r) => (r.length > 0 ? r : cfbd.eloRatings(SEASON, 1))),
    db.from("teams").select("id, school, alt_names"),
  ]);
  const nameIndex = buildTeamNameIndex(
    (teamRows ?? []) as Array<{ id: number; school: string; alt_names: string[] | null }>,
  );

  const rows: Json[] = [];
  const unmatched = new Set<string>();
  const push = (system: string, school: string, value: number | null | undefined) => {
    if (value === null || value === undefined) return;
    const teamId = nameIndex.get(school.toLowerCase());
    if (teamId === undefined) {
      unmatched.add(school);
      return;
    }
    rows.push({
      season_id: SEASON,
      team_id: teamId,
      system,
      week,
      value,
      fetched_at: new Date().toISOString(),
    });
  };
  for (const r of sp) push("sp", r.team, r.rating);
  for (const r of fpi) push("fpi", r.team, r.fpi);
  for (const r of elo) push("elo", r.team, r.elo);
  /* Per system, not a total. `rows: 276` is what this job reported for months
     while storing zero Elo — sp 138 + fpi 138 reads like a healthy number, and
     a green run with a whole feed missing is indistinguishable from a green run
     that worked. The consensus flag needs all three, so one absent feed
     silently disables it on every frozen receipt. Counted here so /admin and
     `job_runs.detail` can show the hole. */
  const bySystem = { sp: 0, fpi: 0, elo: 0 } as Record<string, number>;
  for (const r of rows) bySystem[(r as { system: string }).system]++;

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("system_ratings").upsert(rows.slice(i, i + 500), {
      onConflict: "season_id,system,week,team_id",
    });
    if (error) throw new Error(error.message);
  }

  return {
    week,
    rows: rows.length,
    by_system: bySystem,
    /* Names the empty ones rather than leaving it to be spotted in a map — a
       missing feed is the finding, and it should read as one. */
    ...(Object.entries(bySystem).filter(([, n]) => n === 0).length > 0
      ? { empty_systems: Object.entries(bySystem).filter(([, n]) => n === 0).map(([k]) => k) }
      : {}),
    unmatched: [...unmatched],
  };
}

/** Open-Meteo forecasts for outdoor games in the next 7 days. */
/**
 * Materialise every group week whose first game has kicked off.
 *
 * `full_slate` and `conference` boards resolve live from `games` until they
 * freeze, which is what lets a game added to the schedule join the board on
 * its own. Once the week starts that has to stop, or a postponement moving a
 * game to another week would silently pull it off a board people already
 * picked. `freeze_group_week` copies the resolved list into
 * `group_week_games` and stamps `locked_at`.
 *
 * It does NOT decide whether the week is locked — `group_week_is_locked` reads
 * the clock, and `set_group_week_config` rejects edits on its own. So a missed
 * run costs materialisation, never correctness, and the function is idempotent
 * and cheap enough to call on every lines refresh.
 */
export async function freezeGroupWeeksJob(db: SupabaseClient): Promise<Json> {
  const { data: pending } = await db
    .from("group_week_config")
    .select("group_id, season_id, week, season_type")
    .is("locked_at", null);
  if (!pending || pending.length === 0) return { considered: 0, frozen: 0 };

  let frozen = 0;
  for (const c of pending as Array<{
    group_id: string;
    season_id: number;
    week: number;
    season_type: string;
  }>) {
    const { data, error } = await db.rpc("freeze_group_week", {
      p_group: c.group_id,
      p_season: c.season_id,
      p_week: c.week,
      p_season_type: c.season_type,
    });
    // A week whose first kickoff is still ahead returns false; that is the
    // normal case for most rows on most runs, not a failure.
    if (!error && data === true) frozen++;
  }
  return { considered: pending.length, frozen };
}

export async function weatherJob(db: SupabaseClient): Promise<Json> {
  const horizon = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const { data: games } = await db
    .from("games")
    .select("id, start_ts, venue_id")
    .eq("season_id", SEASON)
    .eq("status", "scheduled")
    .gt("start_ts", new Date().toISOString())
    .lte("start_ts", horizon)
    .not("venue_id", "is", null);
  if (!games || games.length === 0) return { forecasts: 0 };

  const venueIds = [...new Set(games.map((g: { venue_id: number }) => g.venue_id))];
  const [{ data: venues }, { data: overrides }] = await Promise.all([
    db.from("venues").select("id, latitude, longitude, dome").in("id", venueIds),
    db
      .from("venue_coord_overrides")
      .select("venue_id, latitude, longitude")
      .in("venue_id", venueIds),
  ]);
  const coords = new Map<number, { lat: number; lon: number; dome: boolean }>();
  for (const v of venues ?? []) {
    if (v.latitude !== null && v.longitude !== null) {
      coords.set(v.id, { lat: v.latitude, lon: v.longitude, dome: v.dome });
    }
  }
  for (const o of overrides ?? []) {
    coords.set(o.venue_id, { lat: o.latitude, lon: o.longitude, dome: false });
  }

  let forecasts = 0;
  for (const g of games as Array<{ id: number; start_ts: string; venue_id: number }>) {
    const c = coords.get(g.venue_id);
    if (!c || c.dome) continue;
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,precipitation` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=7&timezone=UTC`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const wx = (await res.json()) as {
      hourly: {
        time: string[];
        temperature_2m: number[];
        wind_speed_10m: number[];
        wind_gusts_10m: number[];
        precipitation_probability: number[];
        precipitation: number[];
      };
    };
    const kickHour = g.start_ts.slice(0, 13);
    const idx = wx.hourly.time.findIndex((t) => t.startsWith(kickHour));
    if (idx === -1) continue;
    const { error } = await db.from("weather_forecasts").upsert({
      game_id: g.id,
      temp_f: wx.hourly.temperature_2m[idx],
      wind_mph: wx.hourly.wind_speed_10m[idx],
      wind_gust_mph: wx.hourly.wind_gusts_10m[idx],
      precip_prob: wx.hourly.precipitation_probability[idx],
      precip_in: wx.hourly.precipitation[idx],
      fetched_at: new Date().toISOString(),
    });
    if (!error) forecasts++;
  }
  return { forecasts };
}

/**
 * Sunday job: stateless season replay from week-0 priors over all final games
 * → blended ratings rows per week (idempotent), then grade picks/bets + CLV
 * against the closing consensus (last snapshots before kickoff).
 */
export async function ratingsUpdateJob(db: SupabaseClient): Promise<Json> {
  const { data: priorRows } = await db
    .from("ratings")
    .select("team_id, overall, offense, defense")
    .eq("season_id", SEASON)
    .eq("week", 0);
  if (!priorRows || priorRows.length === 0) throw new Error("no week-0 priors");
  const priors = new Map<number, number>();
  // Preseason halves exactly as stored: this job never re-derives them, so
  // whatever the preseason build wrote (even split, or a fitted tilt once
  // `backtest.ts --tune-preseason-tilts` earns one) carries the season.
  const priorOff = new Map<number, number>();
  const priorDef = new Map<number, number>();
  for (const r of priorRows as Array<{
    team_id: number;
    overall: number;
    offense: number | null;
    defense: number | null;
  }>) {
    const overall = Number(r.overall);
    priors.set(r.team_id, overall);
    priorOff.set(r.team_id, r.offense === null ? overall / 2 : Number(r.offense));
    priorDef.set(r.team_id, r.defense === null ? overall / 2 : Number(r.defense));
  }

  // BOTH season types: grading must settle bowls and the CFP (groups support
  // postseason weeks), while the ratings replay below stays regular-only —
  // the tuned parameters were fit on regular seasons.
  const { data: gameRows } = await db
    .from("games")
    .select(
      "id, week, season_type, home_team_id, away_team_id, home_points, away_points, neutral_site, status, start_ts",
    )
    .eq("season_id", SEASON)
    .order("week");
  const allGames = (gameRows ?? []) as Array<{
    id: number;
    week: number;
    season_type: string;
    home_team_id: number;
    away_team_id: number;
    home_points: number | null;
    away_points: number | null;
    neutral_site: boolean;
    status: string;
    start_ts: string | null;
  }>;
  const games = allGames.filter((g) => g.season_type === "regular");
  const finals = games.filter(
    (g) => g.status === "final" && g.home_points !== null && g.away_points !== null,
  );

  const fcsTop = await loadFcsTop(db);

  const { data: hfaRows } = await db.from("team_hfa").select("team_id, blended_hfa");
  const hfa = new Map<number, number>(
    (hfaRows ?? []).map((r: { team_id: number; blended_hfa: number }) => [
      r.team_id,
      Number(r.blended_hfa),
    ]),
  );

  // Off/def carry the replay (§2.2) — same structure the backtest validated:
  // totals MAE beat the constant baseline (13.09 vs 13.72 over 2023–25) while
  // margins reproduced the tuned behavior (updateSubRatings' off+def deltas
  // sum to the old overall delta). Priors split evenly; results differentiate.
  const offense = new Map<number, number>(priorOff);
  const defense = new Map<number, number>(priorDef);
  const weeksPlayed = [...new Set(finals.map((g) => g.week))].sort((a, b) => a - b);
  const ratingRows: Json[] = [];
  for (const week of weeksPlayed) {
    for (const g of finals.filter((x) => x.week === week)) {
      const blended = (teamId: number): TeamRating => {
        const prior = priors.get(teamId);
        if (prior === undefined) {
          const f = fcsRatingOf(teamId, fcsTop, DEFAULT_PARAMS);
          return { overall: f, offense: f / 2, defense: f / 2, tempo: 70 };
        }
        const pOff = priorOff.get(teamId) ?? prior / 2;
        const pDef = priorDef.get(teamId) ?? prior / 2;
        const off = blendWithPrior(pOff, offense.get(teamId) ?? pOff, week, DEFAULT_PARAMS);
        const def = blendWithPrior(pDef, defense.get(teamId) ?? pDef, week, DEFAULT_PARAMS);
        return { overall: off + def, offense: off, defense: def, tempo: 70 };
      };
      const home = blended(g.home_team_id);
      const away = blended(g.away_team_id);
      const upd = updateSubRatings(
        {
          homeOffense: home.offense,
          homeDefense: home.defense,
          awayOffense: away.offense,
          awayDefense: away.defense,
          homePoints: g.home_points as number,
          awayPoints: g.away_points as number,
          hfa: hfa.get(g.home_team_id) ?? DEFAULT_PARAMS.baseHfa,
          neutralSite: g.neutral_site,
        },
        DEFAULT_PARAMS,
      );
      if (priors.has(g.home_team_id)) {
        offense.set(g.home_team_id, (offense.get(g.home_team_id) ?? 0) + upd.homeOffDelta);
        defense.set(g.home_team_id, (defense.get(g.home_team_id) ?? 0) + upd.homeDefDelta);
      }
      if (priors.has(g.away_team_id)) {
        offense.set(g.away_team_id, (offense.get(g.away_team_id) ?? 0) + upd.awayOffDelta);
        defense.set(g.away_team_id, (defense.get(g.away_team_id) ?? 0) + upd.awayDefDelta);
      }
    }
    const nextWeek = week + 1;
    for (const [teamId, prior] of priors) {
      const pOff = priorOff.get(teamId) ?? prior / 2;
      const pDef = priorDef.get(teamId) ?? prior / 2;
      const off = blendWithPrior(pOff, offense.get(teamId) ?? pOff, nextWeek, DEFAULT_PARAMS);
      const def = blendWithPrior(pDef, defense.get(teamId) ?? pDef, nextWeek, DEFAULT_PARAMS);
      ratingRows.push({
        season_id: SEASON,
        team_id: teamId,
        week: nextWeek,
        overall: Math.round((off + def) * 100) / 100,
        offense: Math.round(off * 100) / 100,
        defense: Math.round(def * 100) / 100,
        tempo: 70,
        prior_weight: Math.round(priorWeight(nextWeek, DEFAULT_PARAMS) * 1000) / 1000,
        model_version: MODEL_VERSION,
      });
    }
  }
  for (let i = 0; i < ratingRows.length; i += 500) {
    const { error } = await db
      .from("ratings")
      .upsert(ratingRows.slice(i, i + 500), { onConflict: "season_id,team_id,week" });
    if (error) throw new Error(error.message);
  }

  // Grading + League Rule #4 voids, for this season's finals — shared with
  // the nfl-grade task, which runs the same settlement over season 102026.
  const graded = await gradeSeasonFinals(db, SEASON);

  return {
    weeks: weeksPlayed.length,
    ratingRows: ratingRows.length,
    ...graded,
  };
}

/**
 * Settle a season's finals: grade picks and bets, record model CLV against
 * the closing consensus, void wagers on dead games (League Rule #4).
 *
 * Extracted from ratingsUpdateJob so the settlement can run for a season the
 * model does not price: the ratings replay is CFB-only (its parameters were
 * fit on CFB seasons and NFL teams have no week-0 priors), but an NFL bet
 * settles into the same ledger with the same math. The predictions pass is a
 * natural no-op for a season that never froze any.
 *
 * Grading covers BOTH season types — bowls, the CFP, and the NFL bracket all
 * settle — while the caller's ratings replay stays regular-season-only.
 *
 * Since GRADE-1 this is the **backstop**, not the only path: `gradeGames`
 * settles a game from the live tick that saw it finish. This pass still runs
 * on its cron and still catches everything, including games that finaled
 * outside a scoreboard window and the dead-game voids, which no live tick does.
 */
export async function gradeSeasonFinals(db: SupabaseClient, seasonId: number): Promise<Json> {
  // Paged (FREEZE-3): a CFB season is ~890 rows and bowls push it past the
  // 1,000-row ceiling in December, exactly when nothing else would notice.
  const gameRows = await pageAll<SettleGameRow>((from, to) =>
    db.from("games").select(SETTLE_COLS).eq("season_id", seasonId).order("id").range(from, to),
  ).catch((e: Error) => {
    throw new Error(`grading: games read failed: ${e.message}`);
  });
  return settleGames(db, gameRows);
}

/**
 * Settle a named set of games, whatever season they belong to.
 *
 * This is `gradeSeasonFinals` narrowed to the games a live tick just looked at,
 * and it exists because grading used to be scheduled-only: `applyScoreboard`
 * wrote scores and touched no wager, so a Saturday-night final sat ungraded
 * until `ratings-update` on Sunday (CFB) or `nfl-grade` on Monday. The ledger
 * showed an open bet on a finished game for up to a week, and the slate card
 * had no result to render.
 *
 * The two entry points share `settleGames` and both are idempotent — every
 * query filters on `result is null` — so the scheduled pass stays the backstop
 * and double-running costs nothing. Same shape as `voidWagersForGames`, for the
 * same reason (P1-1).
 */
export async function gradeGames(db: SupabaseClient, gameIds: number[]): Promise<Json> {
  if (gameIds.length === 0) return { picksGraded: 0, betsGraded: 0, predictionsGraded: 0, voided: 0 };
  const { data: gameRows, error: gamesErr } = await db
    .from("games")
    .select(SETTLE_COLS)
    .in("id", gameIds);
  if (gamesErr) throw new Error(`grading: games read failed: ${gamesErr.message}`);
  return settleGames(db, (gameRows ?? []) as SettleGameRow[]);
}

export const SETTLE_COLS = "id, home_points, away_points, status, start_ts";

interface SettleGameRow {
  id: number;
  home_points: number | null;
  away_points: number | null;
  status: string;
  start_ts: string | null;
}

/**
 * The settlement body both entry points share.
 *
 * Order matters and is not the obvious one: the ungraded rows are read BEFORE
 * the closing lines, so the snapshot read covers only the games that actually
 * have something to settle. On the scheduled pass that is the same set it
 * always was; on a live tick, where nearly every call finds nothing ungraded,
 * it turns the expensive `line_snapshots` read into no query at all.
 */
async function settleGames(db: SupabaseClient, allGames: SettleGameRow[]): Promise<Json> {
  // What grading settles: finals of either season type, plus the dead games
  // League Rule #4 voids.
  const gradableFinals = allGames.filter(
    (g) => g.status === "final" && g.home_points !== null && g.away_points !== null,
  );
  const deadGames = allGames.filter((g) => isDeadStatus(g.status));

  const finalIds = gradableFinals.map((g) => g.id);
  let picksGraded = 0;
  let betsGraded = 0;
  let predictionsGraded = 0;
  let voided = 0;
  if (finalIds.length > 0) {
    const gameById = new Map(gradableFinals.map((g) => [g.id, g]));

    // Only frozen rows, and only ones not yet graded: predictions is
    // append-only history, and re-grading would rewrite a receipt. The two
    // prediction fields written here didn't exist at freeze time; every number
    // the model committed to stays exactly as it was stored.
    const { data: predRows, error: predsErr } = await db
      .from("predictions")
      .select("id, game_id, edge, vegas_spread, close_spread")
      .eq("frozen", true)
      .in("game_id", finalIds)
      // close_spread, not clv, marks "graded": a row priced without a line
      // has clv null forever by construction, and keying the ungraded set on
      // clv would re-fetch it every Sunday until January (audit 05/N11).
      .is("close_spread", null);
    if (predsErr) throw new Error(`grading: predictions read failed: ${predsErr.message}`);

    const { data: pickRows, error: picksErr } = await db
      .from("picks")
      .select("id, game_id, market, side, line_at_pick, result")
      .in("game_id", finalIds)
      .is("result", null);
    if (picksErr) throw new Error(`grading: picks read failed: ${picksErr.message}`);

    const { data: betRows, error: betsErr } = await db
      .from("bets")
      .select("id, game_id, bet_type, side, team_side, line_taken, odds, units, result")
      .in("game_id", finalIds)
      .is("result", null)
      .is("voided_at", null);
    if (betsErr) throw new Error(`grading: bets read failed: ${betsErr.message}`);

    const preds = predRows ?? [];
    const picks = pickRows ?? [];
    const bets = betRows ?? [];

    // Closing lines only for the games carrying something ungraded. Chunked
    // (PostgREST .in() is a URL; ~800 final ids by December) and THROWING: a
    // swallowed read error here used to grade the week without CLV
    // permanently, with the Action green (audit 05/N4).
    const needClose = [
      ...new Set([
        ...preds.map((p) => p.game_id as number),
        ...picks.map((p) => p.game_id as number),
        ...bets.map((b) => b.game_id as number),
      ]),
    ];
    const snapsByGame = new Map<number, Snapshot[]>();
    // Paged inside each chunk (FREEZE-3): 300 games carry far more than 1,000
    // snapshots by kickoff, and the unpaged read silently returned the first
    // 1,000 — which is why Week 1 finals were graded with no close.
    for (let i = 0; i < needClose.length; i += 300) {
      const chunk = needClose.slice(i, i + 300);
      const snaps = await pageAll<Snapshot>((from, to) =>
        db.from("line_snapshots").select(SNAPSHOT_COLS).in("game_id", chunk).order("id").range(from, to),
      ).catch((e: Error) => {
        throw new Error(`grading: snapshots read failed: ${e.message}`);
      });
      for (const s of snaps) {
        const arr = snapsByGame.get(s.game_id) ?? [];
        arr.push(s);
        snapsByGame.set(s.game_id, arr);
      }
    }
    const closing = (gameId: number) => {
      const g = gameById.get(gameId);
      return closingConsensus(snapsByGame.get(gameId) ?? [], g?.start_ts ?? null);
    };

    // First-half bets need the halftime score, which only `scoring_plays` can
    // prove (R2-A4). One chunked read covering just the games that carry an
    // ungraded first_half bet — most grade passes read nothing here. A game
    // whose plays can't prove the split (firstHalfScore null) stays out of
    // the map and its bets stay ungraded for manual settle, never guessed.
    const fhGameIds = [
      ...new Set(
        bets.filter((b) => b.bet_type === "first_half").map((b) => b.game_id as number),
      ),
    ];
    const halfByGame = new Map<number, HalfScore>();
    for (let i = 0; i < fhGameIds.length; i += 300) {
      // No .order(): buildBoxScore sorts by sequence itself.
      const fhChunk = fhGameIds.slice(i, i + 300);
      const playRows = await pageAll<Parameters<typeof firstHalfScore>[0][number]>((from, to) =>
        db
          .from("scoring_plays")
          .select("game_id, sequence, period, clock, scoring_team_id, play_type, play_text, home_points, away_points, source")
          .in("game_id", fhChunk)
          .order("id")
          .range(from, to),
      ).catch((e: Error) => {
        throw new Error(`grading: scoring_plays read failed: ${e.message}`);
      });
      const byGame = new Map<number, typeof playRows>();
      for (const p of playRows ?? []) {
        const arr = byGame.get(p.game_id as number) ?? [];
        arr.push(p);
        byGame.set(p.game_id as number, arr);
      }
      for (const [gid, plays] of byGame) {
        const g = gameById.get(gid);
        if (!g) continue;
        const half = firstHalfScore(
          (plays ?? []) as Parameters<typeof firstHalfScore>[0],
          g.home_points as number,
          g.away_points as number,
        );
        if (half) halfByGame.set(gid, half);
      }
    }

    // Model CLV. The leans are published as information rather than bets, so
    // the ATS column can't carry the model's scoreboard on its own — CLV asks
    // the better question (did the market come to us after we committed?) and
    // converges on a single season where a win rate does not.
    for (const p of preds as Array<{
      id: number;
      game_id: number;
      edge: number | null;
      vegas_spread: number | null;
      close_spread: number | null;
    }>) {
      const close = closing(p.game_id).spread;
      // No closing line means nothing to measure. Leave clv null so the row
      // stays in the ungraded set and a later lines backfill can still catch
      // it, rather than banking a 0 that reads as "dead even".
      if (close === null) continue;
      const clv = modelClv(
        p.edge === null ? null : Number(p.edge),
        p.vegas_spread === null ? null : Number(p.vegas_spread),
        close,
      );
      // A row priced without a line (edge/vegas_spread null) can never grow a
      // CLV — still record the close so it stops being re-fetched from the
      // ungraded set every Sunday forever (audit 05/N11).
      const { error } = await db
        .from("predictions")
        .update(clv === null ? { close_spread: close } : { clv: roundClv(clv), close_spread: close })
        .eq("id", p.id);
      if (!error && clv !== null) predictionsGraded++;
    }

    for (const p of picks) {
      const g = gameById.get(p.game_id)!;
      const line = Number(p.line_at_pick);
      const close = closing(p.game_id);
      const result = gradePick(
        p.market as PickMarket,
        p.side,
        p.line_at_pick === null ? null : line,
        g.home_points as number,
        g.away_points as number,
      );
      // A row the grader cannot settle stays ungraded rather than banking a
      // guess; the check constraint in 0021 should keep this unreachable.
      if (result === null) continue;

      // Straight-up takes no number, so there is nothing to compare a close to.
      let clv: number | null = null;
      if (p.market === "spread" && close.spread !== null) {
        clv = roundClv(spreadClv(p.side as "home" | "away", line, close.spread));
      } else if (p.market === "total" && close.total !== null) {
        clv = roundClv(totalClv(p.side as "over" | "under", line, close.total));
      }

      const { error } = await db.from("picks").update({ result, clv }).eq("id", p.id);
      if (!error) picksGraded++;
    }

    for (const b of bets) {
      // A moneyline bet has no line to take, so `line_taken` being null is
      // normal for it rather than a reason to skip. It used to be caught by
      // this guard and sat ungraded forever, quietly missing from the ledger's
      // record and units.
      if (!b.side) continue;
      const g = gameById.get(b.game_id)!;
      const margin = (g.home_points as number) - (g.away_points as number);
      const total = (g.home_points as number) + (g.away_points as number);
      const line = b.line_taken === null ? null : Number(b.line_taken);
      const close = closing(b.game_id);
      let result: string | null = null;
      let clv: number | null = null;
      let closingLine: number | null = null;
      if (b.bet_type === "spread" && line !== null && (b.side === "home" || b.side === "away")) {
        const cm = coverMargin(b.side, line, g.home_points as number, g.away_points as number);
        result = cm > 0 ? "win" : cm < 0 ? "loss" : "push";
        closingLine = close.spread;
        if (close.spread !== null) clv = roundClv(spreadClv(b.side, line, close.spread));
      } else if (
        b.bet_type === "total" &&
        line !== null &&
        (b.side === "over" || b.side === "under")
      ) {
        const diff = b.side === "over" ? total - line : line - total;
        result = diff > 0 ? "win" : diff < 0 ? "loss" : "push";
        closingLine = close.total;
        if (close.total !== null) clv = roundClv(totalClv(b.side, line, close.total));
      } else if (b.bet_type === "moneyline" && (b.side === "home" || b.side === "away")) {
        // Who won, full stop. CLV on a moneyline is measured in cents against a
        // closing price we do not capture — spec §5.3 — so it stays null rather
        // than being invented from the spread.
        result = margin === 0 ? "push" : (margin > 0) === (b.side === "home") ? "win" : "loss";
      } else if (
        b.bet_type === "team_total" &&
        line !== null &&
        (b.side === "over" || b.side === "under") &&
        (b.team_side === "home" || b.team_side === "away")
      ) {
        // R2-A4. Legacy rows (team_side null — the subject team lives only in
        // the description) fall through ungraded for manual settle: skipping
        // beats guessing. No closing team-total is captured, so CLV stays null.
        const teamPts =
          b.team_side === "home" ? (g.home_points as number) : (g.away_points as number);
        result = gradeTeamTotal(b.side, line, teamPts);
      } else if (
        b.bet_type === "first_half" &&
        line !== null &&
        (b.side === "home" || b.side === "away")
      ) {
        // R2-A4. Settles only when scoring_plays PROVE the halftime score
        // (see firstHalfScore); otherwise the row stays for manual settle.
        // No closing 1H line is captured, so CLV stays null.
        const half = halfByGame.get(b.game_id as number);
        if (half) {
          const cm = coverMargin(b.side, line, half.home, half.away);
          result = cm > 0 ? "win" : cm < 0 ? "loss" : "push";
        }
      }
      if (result === null) continue;
      const units = Number(b.units);
      const odds = Number(b.odds);
      // Correct for any American price, which is what makes a +2500 moneyline
      // pay what it should rather than -110.
      const win = odds > 0 ? units * (odds / 100) : units * (100 / -odds);
      const payout = result === "win" ? win : result === "loss" ? -units : 0;
      const { error } = await db
        .from("bets")
        .update({
          result,
          clv,
          closing_line: closingLine,
          payout_units: Math.round(payout * 100) / 100,
        })
        .eq("id", b.id);
      if (!error) betsGraded++;
    }
  }

  // League Rule #4: postponed/canceled = void, for picks and bets alike. This
  // only ever voids wagers on games that are dead RIGHT NOW, and a game that
  // later revives grades normally when it goes final: voided BETS are excluded
  // from the grading queries above, and since 0034 a re-picked game clears its
  // `result` in `make_pick`'s upsert, so the member's new pick is gradable.
  // (Before 0034 the upsert set only side/line/locked_at, so a re-pick
  // inherited `result='void'` and the grader's `.is("result", null)` filter
  // skipped it forever — the "member re-picks" path was documented here but
  // did not work.)
  //
  // Since P1-1 the same write also runs inline from the /admin control, so a
  // Saturday postponement voids immediately rather than waiting for Sunday.
  // Both callers share `voidWagersForGames` and both are idempotent.
  if (deadGames.length > 0) {
    const counts = await voidWagersForGames(
      db,
      deadGames.map((g) => g.id),
    );
    voided = counts.picks + counts.bets;
  }

  return { picksGraded, betsGraded, predictionsGraded, voided };
}

/* ---- scoring timeline (SCORE-1) ---------------------------------------- */

interface ScoringGame {
  id: number;
  home_points: number | null;
  away_points: number | null;
  home_team_id: number;
  away_team_id: number;
  week: number;
  season_type: string;
}

/**
 * Which games need their scoring summary re-read, and which do not.
 *
 * This is the entire cost control for the feature. `NFL-12` left the per-game
 * ESPN `/summary` call as a decision owed on the grounds that one call per live
 * game per tick is ~16x the single scoreboard call on a Sunday. It is only
 * affordable because it does not have to be per tick: each stored row carries
 * the running score after it, so the last row says how many points are already
 * accounted for. If that equals the game's score, nothing has happened since
 * the last read and there is nothing to fetch.
 *
 * ~1 call per SCORE rather than per tick. A 47-point game costs about a dozen
 * calls across three hours instead of ~360.
 *
 * A game with no scoring rows and no points is skipped too — a scoreless first
 * quarter is not a reason to poll.
 */
export function gamesNeedingScoring(
  games: ScoringGame[],
  coveredByGame: Map<number, number>,
): ScoringGame[] {
  return games.filter((g) => {
    const scored = (g.home_points ?? 0) + (g.away_points ?? 0);
    if (scored === 0) return false;
    return scored > (coveredByGame.get(g.id) ?? 0);
  });
}

/** Read how many points each game's stored timeline already accounts for. */
async function coveredPointsByGame(
  db: SupabaseClient,
  gameIds: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (gameIds.length === 0) return out;
  const { data, error } = await db
    .from("scoring_plays")
    .select("game_id, sequence, home_points, away_points")
    .in("game_id", gameIds)
    .order("sequence", { ascending: true });
  if (error) throw new Error(`scoring: read failed: ${error.message}`);
  const byGame = new Map<number, Array<{ homePoints: number; awayPoints: number }>>();
  for (const r of (data ?? []) as Array<{
    game_id: number;
    home_points: number;
    away_points: number;
  }>) {
    const arr = byGame.get(r.game_id) ?? [];
    arr.push({ homePoints: r.home_points, awayPoints: r.away_points });
    byGame.set(r.game_id, arr);
  }
  for (const [id, plays] of byGame) out.set(id, pointsCovered(plays));
  return out;
}

/** Upsert one game's timeline. Idempotent on (game_id, sequence). */
async function writeScoringPlays(
  db: SupabaseClient,
  gameId: number,
  plays: ScoringPlay[],
  teamIdFor: (p: ScoringPlay, index: number) => number | null,
  source: string,
): Promise<number> {
  if (plays.length === 0) return 0;
  const rows = plays.map((p, i) => ({
    game_id: gameId,
    sequence: p.sequence,
    period: p.period,
    clock: p.clock,
    scoring_team_id: teamIdFor(p, i),
    play_type: p.playType,
    play_text: p.text,
    home_points: p.homePoints,
    away_points: p.awayPoints,
    source,
  }));
  const { error } = await db.from("scoring_plays").upsert(rows, { onConflict: "game_id,sequence" });
  if (error) throw new Error(`scoring: write failed for game ${gameId}: ${error.message}`);
  return rows.length;
}

/**
 * NFL scoring timelines, from ESPN's per-game summary.
 *
 * One call per game that has scored since the last read — see
 * `gamesNeedingScoring`. Errors on a single game are logged and skipped rather
 * than thrown: a missing summary costs that game its timeline, and failing the
 * whole job over it would cost every game its live score.
 */
export async function nflScoringJob(db: SupabaseClient, seasonId: number): Promise<Json> {
  const { data, error } = await db
    .from("games")
    .select("id, home_points, away_points, home_team_id, away_team_id, week, season_type")
    .eq("season_id", seasonId)
    .in("status", ["in_progress", "final"]);
  if (error) throw new Error(`scoring: games read failed: ${error.message}`);
  const games = (data ?? []) as ScoringGame[];

  const covered = await coveredPointsByGame(db, games.map((g) => g.id));
  const todo = gamesNeedingScoring(games, covered);
  if (todo.length === 0) return { games: 0, plays: 0 };

  let written = 0;
  let failed = 0;
  for (const g of todo) {
    try {
      const summary = await espn.summary(g.id);
      const plays = parseScoringPlays(summary);
      written += await writeScoringPlays(
        db,
        g.id,
        plays,
        // ESPN ids are pre-offset on the play; the stored team id is not.
        (p) => (p.espnTeamId === null ? null : nflTeamId(p.espnTeamId)),
        "espn",
      );
    } catch (err) {
      failed++;
      console.error(`scoring: game ${g.id} failed: ${(err as Error).message}`);
    }
  }
  return { games: todo.length, plays: written, ...(failed ? { failed } : {}) };
}

/**
 * CFB scoring timelines, from CFBD's week-scoped plays route.
 *
 * The shape is forced by the feed: CFBD has no per-game plays endpoint, so one
 * call returns every play of every FBS game in the week and the scoring rows
 * are filtered out of it. That is a multi-MB response for a few dozen rows, and
 * it is why this belongs on a slow cadence rather than on the 30-second tick.
 *
 * One call per WEEK that has games needing an update, not per game — so a
 * fifteen-game Saturday afternoon costs exactly one call, and the arithmetic
 * gets better as the slate gets busier.
 *
 * CFBD names the scoring team as a school string rather than an id, so it is
 * matched against the game's own two teams. A name that matches neither leaves
 * the crest off the row rather than dropping it — the play text is the feature.
 */
export async function cfbScoringJob(db: SupabaseClient, seasonId: number): Promise<Json> {
  const { data, error } = await db
    .from("games")
    .select("id, home_points, away_points, home_team_id, away_team_id, week, season_type")
    .eq("season_id", seasonId)
    .in("status", ["in_progress", "final"]);
  if (error) throw new Error(`scoring: games read failed: ${error.message}`);
  const games = (data ?? []) as ScoringGame[];

  const covered = await coveredPointsByGame(db, games.map((g) => g.id));
  const todo = gamesNeedingScoring(games, covered);
  if (todo.length === 0) return { games: 0, plays: 0, calls: 0 };

  const teamIds = [...new Set(todo.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: teamRows } = await db.from("teams").select("id, school").in("id", teamIds);
  const schoolById = new Map(
    ((teamRows ?? []) as Array<{ id: number; school: string }>).map((t) => [t.id, t.school]),
  );

  // One call per (week, season_type) bucket, not per game.
  const buckets = new Map<string, { week: number; seasonType: string; games: ScoringGame[] }>();
  for (const g of todo) {
    const key = `${g.week}:${g.season_type}`;
    const b = buckets.get(key) ?? { week: g.week, seasonType: g.season_type, games: [] };
    b.games.push(g);
    buckets.set(key, b);
  }

  let written = 0;
  let calls = 0;
  for (const b of buckets.values()) {
    const plays = await cfbd.plays(seasonYearOf(seasonId), {
      week: b.week,
      seasonType: b.seasonType,
    });
    calls++;
    for (const g of b.games) {
      const scoring = cfbdScoringPlays(plays, g.id);
      const offenses = cfbdScoringOffense(plays, g.id);
      const home = schoolById.get(g.home_team_id) ?? null;
      const away = schoolById.get(g.away_team_id) ?? null;
      written += await writeScoringPlays(
        db,
        g.id,
        scoring,
        (_p, i) => {
          const school = offenses[i];
          if (!school) return null;
          if (home !== null && school === home) return g.home_team_id;
          if (away !== null && school === away) return g.away_team_id;
          return null;
        },
        "cfbd",
      );
    }
  }
  return { games: todo.length, plays: written, calls };
}

/**
 * Which of a week's scheduled games this freeze run should stamp: games whose
 * OWN kickoff is inside the horizon and which have no frozen prediction yet.
 * A TBD kickoff (null start_ts) in the current week freezes rather than
 * waiting on a timestamp that may never firm up. `ignoreHorizon` is the
 * manual --force path — it widens the window but can never mint a duplicate,
 * because the already-frozen skip is not bypassable.
 */
export function freezableGames<G extends { id: number; start_ts: string | null }>(
  games: G[],
  alreadyFrozen: ReadonlySet<number>,
  now: number,
  horizonDays: number,
  ignoreHorizon = false,
): G[] {
  return games.filter((g) => {
    if (alreadyFrozen.has(g.id)) return false;
    if (ignoreHorizon || g.start_ts === null) return true;
    return (Date.parse(g.start_ts) - now) / DAY_MS <= horizonDays;
  });
}

/**
 * Thursday job: freeze predictions for the upcoming week (receipts), pricing
 * with current ratings + team HFA + admin-CONFIRMED rating adjustments.
 */
export async function freezeJob(
  db: SupabaseClient,
  opts: { dryRun?: boolean } = {},
): Promise<Json> {
  const { week, seasonType } = await fetchCurrentSlate(db, SEASON);

  const { data: gameRows } = await db
    .from("games")
    .select("id, home_team_id, away_team_id, neutral_site, status, start_ts")
    .eq("season_id", SEASON)
    .eq("week", week)
    .eq("season_type", seasonType)
    .eq("status", "scheduled");
  const games = (gameRows ?? []) as Array<{
    id: number;
    home_team_id: number;
    away_team_id: number;
    neutral_site: boolean;
    start_ts: string | null;
  }>;
  if (games.length === 0) return { week, frozen: 0 };

  // One game, one freeze, the Thursday before IT kicks. The old gate checked
  // only the week's EARLIEST kickoff and then froze the whole week — harmless
  // when a week is one weekend, wrong for CFBD's merged Week 0/1 (2026: 99
  // games across Aug 29–Sep 7): the Aug 27 run would stamp the Sep 5 slate
  // nine days early on preseason ratings and stale lines, and the Sep 3 run
  // would stamp it AGAIN — predictions is append-only, so the first batch
  // becomes a silently superseded "receipt", and both batches grade for CLV.
  // Per-game horizon + already-frozen skip gives each game exactly one
  // receipt, priced with everything known the Thursday before its kickoff.
  const horizonDays = envDays("FREEZE_HORIZON_DAYS", 8);
  const { data: frozenRows } = await db
    .from("predictions")
    .select("game_id")
    .eq("frozen", true)
    .in("game_id", games.map((g) => g.id));
  const alreadyFrozen = new Set(
    ((frozenRows ?? []) as Array<{ game_id: number }>).map((r) => r.game_id),
  );
  const toFreeze = freezableGames(games, alreadyFrozen, Date.now(), horizonDays, idleOverridden());
  if (toFreeze.length === 0) {
    return {
      week,
      frozen: 0,
      scheduled: games.length,
      already_frozen: alreadyFrozen.size,
      skipped: "nothing_inside_horizon",
    };
  }

  const fcsTop = await loadFcsTop(db);

  // Paged (FREEZE-3): ~136 teams × every week crosses 1,000 rows by
  // mid-season; unpaged, the newest weeks would arrive complete and older
  // ones vanish, which happens to be harmless here — but the freeze is the
  // one job that must never learn that by accident.
  const ratingRows = await pageAll<{
    team_id: number;
    week: number;
    overall: number;
    offense: number | null;
    defense: number | null;
  }>((from, to) =>
    db
      .from("ratings")
      .select("team_id, week, overall, offense, defense")
      .eq("season_id", SEASON)
      .order("week", { ascending: false })
      .order("team_id")
      .range(from, to),
  );
  const latest = new Map<number, { overall: number; offense: number; defense: number }>();
  for (const r of ratingRows) {
    if (!latest.has(r.team_id)) {
      latest.set(r.team_id, {
        overall: Number(r.overall),
        offense: Number(r.offense ?? Number(r.overall) / 2),
        defense: Number(r.defense ?? Number(r.overall) / 2),
      });
    }
  }

  const [{ data: hfaRows }, { data: adjRows }, { data: snaps }, { data: systemRows }] =
    await Promise.all([
      db.from("team_hfa").select("team_id, blended_hfa"),
      db
        .from("rating_adjustments")
        .select("team_id, game_id, points")
        .eq("season_id", SEASON)
        .not("confirmed_at", "is", null),
      // FREEZE-3: THIS read is the one that truncated on 2026-09-03. 91 games,
      // 4,423 snapshots, 1,000 returned — 71 receipts stamped with no line.
      pageAll<Snapshot>((from, to) =>
        db
          .from("line_snapshots")
          .select(SNAPSHOT_COLS)
          .in(
            "game_id",
            games.map((g) => g.id),
          )
          .order("id")
          .range(from, to),
      ).then((rows) => ({ data: rows, error: null })),
      pageAll<{ team_id: number; system: string; week: number; value: number }>((from, to) =>
        db
          .from("system_ratings")
          .select("team_id, system, week, value")
          .eq("season_id", SEASON)
          .order("week", { ascending: false })
          .order("system")
          .order("team_id")
          .range(from, to),
      ).then((rows) => ({ data: rows, error: null })),
    ]);
  const hfa = new Map<number, number>(
    (hfaRows ?? []).map((r: { team_id: number; blended_hfa: number }) => [
      r.team_id,
      Number(r.blended_hfa),
    ]),
  );
  const snapsByGame = new Map<number, Snapshot[]>();
  for (const s of (snaps ?? []) as Snapshot[]) {
    const arr = snapsByGame.get(s.game_id) ?? [];
    arr.push(s);
    snapsByGame.set(s.game_id, arr);
  }
  const adjFor = (teamId: number, gameId: number) =>
    (adjRows ?? [])
      .filter(
        (a: { team_id: number; game_id: number | null }) =>
          a.team_id === teamId && (a.game_id === null || a.game_id === gameId),
      )
      .reduce((s: number, a: { points: number }) => s + Number(a.points), 0);

  // latest system value per (system, team) → margins for the consensus flag
  const systems = new Map<string, number>();
  for (const r of (systemRows ?? []) as Array<{ team_id: number; system: string; value: number }>) {
    const key = `${r.system}:${r.team_id}`;
    if (!systems.has(key)) systems.set(key, Number(r.value));
  }
  const sysMargin = (system: "sp" | "fpi" | "elo", homeId: number, awayId: number): number | null => {
    const h = systems.get(`${system}:${homeId}`);
    const a = systems.get(`${system}:${awayId}`);
    if (h === undefined || a === undefined) return null;
    // Elo is not points-scale; ~25 Elo ≈ 1 point of margin
    return system === "elo" ? (h - a) / 25 : h - a;
  };

  // A pure even off/def split prices every total at the league baseline —
  // only store totals when at least some teams carry a real split. Shared with
  // the preseason builder so the two write paths can't drift (src/model).
  const totalsAreReal = splitInformative([...latest.values()]);

  // Early-season pricing widens sigma (and softens the win-prob slope) while
  // the preseason prior is still doing the work — identity until fit.
  const params = paramsForWeek(week, DEFAULT_PARAMS);

  const rows: Json[] = [];
  for (const g of toFreeze) {
    const homeR = latest.get(g.home_team_id);
    const awayR = latest.get(g.away_team_id);
    if (homeR === undefined && awayR === undefined) continue;
    // No rating row means no FBS prior — an FCS buy game. Which bucket it
    // lands in is decided by fcsTopIds; while both params are −30 the answer
    // is the same either way.
    const rating = (
      teamId: number,
      r: { overall: number; offense: number; defense: number } | undefined,
    ): TeamRating => {
      if (r !== undefined) return { ...r, tempo: 70 };
      const f = fcsRatingOf(teamId, fcsTop, DEFAULT_PARAMS);
      return { overall: f, offense: f / 2, defense: f / 2, tempo: 70 };
    };
    const situational = adjFor(g.home_team_id, g.id) - adjFor(g.away_team_id, g.id);
    const vegas = consensus(snapsByGame.get(g.id) ?? []);
    // The consensus flag compares each system to an HFA-inclusive market
    // margin, but SP+/FPI/Elo differentials are neutral-field. Without adding
    // home field the comparison is asymmetric by ~2×HFA: a home lean needed
    // ~6 more points of agreement to fire than an away lean (audit 02/M-03).
    const sysHfa = g.neutral_site ? 0 : (hfa.get(g.home_team_id) ?? DEFAULT_PARAMS.baseHfa);
    const withHfa = (m: number | null) => (m === null ? null : m + sysHfa);
    const price = priceGame(
      {
        home: rating(g.home_team_id, homeR),
        away: rating(g.away_team_id, awayR),
        homeTeamHfa: hfa.get(g.home_team_id) ?? DEFAULT_PARAMS.baseHfa,
        neutralSite: g.neutral_site,
        situationalPoints: situational,
        vegasSpread: vegas.spread,
        // real inputs for the consensus flag (spec §2.4) — previously never
        // passed, so the flag could only ever be false
        spPlusMargin: withHfa(sysMargin("sp", g.home_team_id, g.away_team_id)),
        fpiMargin: withHfa(sysMargin("fpi", g.home_team_id, g.away_team_id)),
        eloMargin: withHfa(sysMargin("elo", g.home_team_id, g.away_team_id)),
      },
      params,
    );
    rows.push({
      game_id: g.id,
      season_id: SEASON,
      model_version: MODEL_VERSION,
      frozen: true,
      spread: Math.round(price.spread * 10) / 10,
      // Totals are real when the off/def split carries information (2023–25
      // calibration: model MAE 13.09 vs constant 13.72). With a pure even
      // split (preseason, no results yet) every total is the league
      // baseline — store null rather than a constant dressed as a prediction.
      // O/U leans stay unflagged either way (50.8%/51.9% < the 52.4% vig).
      total: totalsAreReal ? Math.round(price.projectedTotal * 10) / 10 : null,
      home_score: totalsAreReal ? Math.round(price.projectedHomeScore * 10) / 10 : null,
      away_score: totalsAreReal ? Math.round(price.projectedAwayScore * 10) / 10 : null,
      home_win_prob: Math.round(price.homeWinProb * 10000) / 10000,
      cover_prob:
        price.homeCoverProb !== null ? Math.round(price.homeCoverProb * 10000) / 10000 : null,
      vegas_spread: vegas.spread,
      // The opener is context for the receipt, not the number the model was
      // graded against — CLV measures vegas_spread (what was on the board at
      // freeze) against the close. Storing it here means the movement is
      // readable later without re-deriving it from line_snapshots.
      open_spread: vegas.open,
      edge: price.edge !== null ? Math.round(price.edge * 10) / 10 : null,
      edge_flag: price.edgeFlag,
      consensus_flag: price.consensusFlag,
      /* SYS-1: how the flag was reached, not just what it said. `adjustments`
         is jsonb and already written, so this needs no migration — which
         matters six days from the freeze, where a new column would have to be
         applied to production BEFORE the code that writes it deploys or every
         insert fails. A receipt reading "2 of 2 agreed" stays truthful when Elo
         returns mid-season and the denominator becomes 3. */
      adjustments: {
        situational,
        consensus: { agreed: price.consensusAgreed, available: price.consensusAvailable },
      },
    });
  }
  /* REHEARSE-1. Every other job in the chain can be run twice; this one cannot
     be run at all without spending what it writes. `predictions` is
     append-only and `alreadyFrozen` skips a game that has a row, so a
     rehearsal freeze does not test the Thursday run — it REPLACES it, with
     numbers priced on whatever the board happened to hold that day.
     So the batch can be built and printed instead. Same slate pointer, same
     `freezableGames`, same pricing, same rows — the insert is the only thing
     skipped, which is what makes this worth trusting: it is not a simulation
     of the freeze, it is the freeze, stopped one line short.
     Printed rather than summarised, because the Aug 28 row asks to verify
     `model_version`, non-null `vegas_spread` and non-null `total` per game,
     and a count cannot answer any of those. */
  if (opts.dryRun) {
    for (const r of rows) {
      console.log(
        JSON.stringify({
          game_id: r.game_id,
          model_version: r.model_version,
          spread: r.spread,
          total: r.total,
          vegas_spread: r.vegas_spread,
          open_spread: r.open_spread,
          edge: r.edge,
          edge_flag: r.edge_flag,
          consensus_flag: r.consensus_flag,
          /* SYS-1's loose end: a `false` flag on a printed row could be real
             disagreement between the systems or a rule that still is not
             firing, and the flag alone cannot say which. "agreed 1 of 2" can. */
          consensus: (r.adjustments as { consensus?: object }).consensus,
        }),
      );
    }
    /* The three fields the Aug 28 verification is written against, counted
       here so a red flag is visible in `job_runs.detail` and on /admin rather
       than only to whoever reads the log. */
    return {
      week,
      dry_run: true,
      would_freeze: rows.length,
      missing_vegas_spread: rows.filter((r) => r.vegas_spread === null).length,
      missing_total: rows.filter((r) => r.total === null).length,
      wrong_model_version: rows.filter((r) => r.model_version !== MODEL_VERSION).length,
    };
  }

  if (rows.length > 0) {
    const { error } = await db.from("predictions").insert(rows);
    if (error) throw new Error(error.message);
  }
  return { week, frozen: rows.length };
}

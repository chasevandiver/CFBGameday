/**
 * Did the preseason load actually land? — the check that `load-preseason.ts`
 * does not make.
 *
 * The load upserts rows and prints `Done: N rows loaded`. It never reads back
 * what ended up in the database, so a run is green when the writes did not
 * error — and a green run that loaded the wrong thing is indistinguishable from
 * one that worked. That is the same shape as OPS-4, where a healthy handoff and
 * a dead process wrote the same `job_runs` row.
 *
 * It matters on a date. The Q1 escalation fires **Aug 22, 11:00 UTC,
 * unattended**, and it is the first time the build → load path will ever have
 * completed for 2026. `docs/STATUS.md` says of the checkpoint four days later:
 * *"Do not let this get decided by silence."* Until now the only thing standing
 * between a silent bad load and Week 0 was someone reading a calendar and
 * running queries by hand, twice.
 *
 * ## The verdict is pure
 *
 * Same split as `watchdogVerdict`: the thresholds are decided here against a
 * plain object and tested without a database, and the caller does the reading.
 * A check nobody can run without production credentials is a check nobody runs.
 */

export interface PreseasonState {
  seasonId: number;
  /** Week-0 rating rows for the current season. */
  ratings: number;
  /** Distinct `model_version` values among them. */
  versions: string[];
  /** What the code says it should be. */
  expectedVersion: string;
  /** `team_hfa` rows. */
  hfaRows: number;
  /** Distinct `blended_hfa` values. */
  distinctBlendedHfa: number;
  /** `preseason_components` rows for the season. */
  components: number;
  /** How many of those carry `talent_stale: true`. */
  staleTalentRows: number;
  /** Rows whose offense + defense does not reconstruct overall. */
  halvesMismatched: number;
  /**
   * Teams that carried a rating LAST season but have a null `final_prev_rating`
   * this one. A genuinely new FBS team legitimately has none; a team we rated a
   * year ago and cannot chain is the frozen-pool defect reaching production.
   */
  chainBreaks: number;
  /**
   * Week-0 rating rows for the PREVIOUS season — the basis `chainBreaks` is
   * measured against. Zero means the check has nothing to compare to, which is
   * not the same as passing and must not read like it.
   */
  prevBoard: number;
  /** Completed games in the season — the load refuses a season already playing. */
  finals: number;
}

/**
 * A full board. FBS membership moves, so this is a floor rather than an
 * equality: 2026 is 138, and any year that came back under 130 would mean the
 * build dropped teams rather than that the sport shrank.
 */
export const MIN_BOARD = 130;

export interface PreseasonVerdict {
  /** Fail the run. The load did not land, or landed wrong. */
  problems: string[];
  /**
   * Say it loudly, do not fail. A check that cannot be evaluated is not a
   * check that passed — but it is also not a reason to turn a good load red.
   * Same split `assertFeedCoverage` uses: warn when unprobed, throw when
   * probed-and-bad. A job that goes red every morning for a condition nobody
   * can fix is how this repo already learned people stop reading it.
   */
  notices: string[];
}

/**
 * What has to be true after a load, in the order someone would want to read it.
 * No problems means the load landed.
 */
export function preseasonVerdict(s: PreseasonState): PreseasonVerdict {
  const problems: string[] = [];
  const notices: string[] = [];

  if (s.ratings === 0) {
    // Everything below would also fail and say less. One clear line beats six.
    return {
      problems: [`no week-0 ratings at all for season ${s.seasonId} — the load wrote nothing`],
      notices,
    };
  }
  if (s.ratings < MIN_BOARD) {
    problems.push(`week-0 ratings: ${s.ratings} teams, under the ${MIN_BOARD} a full board needs`);
  }

  if (s.versions.length > 1) {
    // A split board is worse than an old one: half the slate is priced by one
    // model and half by another, and nothing on screen says so.
    problems.push(`mixed model_version on one board: ${s.versions.join(", ")}`);
  } else if (s.versions[0] !== s.expectedVersion) {
    problems.push(
      `model_version is ${s.versions[0]}, code ships ${s.expectedVersion} — the load did not take`,
    );
  }

  if (s.hfaRows !== s.ratings) {
    problems.push(`team_hfa has ${s.hfaRows} rows against ${s.ratings} rated teams`);
  }

  /* 02:M-05 shipped `teamHfaBlend: 0`, so `centeredBlendedHfa` returns
     `baseHfa` for every team and the column must be one value repeated. More
     than one means the rows predate the change however new the ratings look —
     `team_hfa` is derived at build time, so it is exactly the table that can go
     stale without anything else looking wrong. */
  if (s.distinctBlendedHfa > 1) {
    problems.push(
      `team_hfa carries ${s.distinctBlendedHfa} distinct blended_hfa values; teamHfaBlend is 0, ` +
        `so a current build has exactly 1 — these rows are from an older build`,
    );
  }

  if (s.components !== s.ratings) {
    problems.push(
      `preseason_components has ${s.components} rows against ${s.ratings} rated teams — ` +
        `/model cannot explain the missing ones`,
    );
  }

  /* All or nothing. `talent_stale` is stamped on every row from one build-wide
     decision, so a partial set means two builds' rows are mixed together and
     the /model note is right for some teams and wrong for others. */
  if (s.staleTalentRows !== 0 && s.staleTalentRows !== s.components) {
    problems.push(
      `talent_stale is set on ${s.staleTalentRows} of ${s.components} rows — it is one ` +
        `build-wide decision, so a partial set means two builds are mixed`,
    );
  }

  if (s.halvesMismatched > 0) {
    problems.push(`${s.halvesMismatched} ratings where offense + defense != overall`);
  }

  /* The chain check is only as good as the season it compares to. `ratings` for
     the previous season is empty on this project today — nothing has ever
     written a 2025 board — so a naive `ratedLastSeason` set is empty and the
     check silently passes for every team. An unevaluated check reported as a
     pass is worse than no check, and it is the same defect as --tune-team-hfa's
     Gate 0, which printed "r = n/a over n = 0 teams" under GATE FAILS. */
  if (s.prevBoard === 0) {
    notices.push(
      `chain check CANNOT BE EVALUATED: no week-0 ratings for season ${s.seasonId - 1}, so ` +
        `"was this team rated last season" has no answer and Track B's effect is unverifiable ` +
        `here. Not a failure — this project has never written a prior-season board, and turning ` +
        `a good load red over it is the cry-wolf pattern jobs.yml already warns about.`,
    );
  }

  /* Track B's own check. The fix admits mid-window FBS entrants to the chain,
     so a team rated last season must have a prior rating to chain from this
     one. Before it, the five 2023-2025 entrants carried final_prev_rating null
     and were built from talent alone. */
  if (s.chainBreaks > 0) {
    problems.push(
      `${s.chainBreaks} teams were rated last season but have no final_prev_rating this one — ` +
        `the FBS-admission fix (Track B) is not in the build that produced these rows`,
    );
  }

  if (s.finals > 0) {
    // Not a load failure — a statement that the window has closed. Week-0
    // ratings stop being current the moment a game is final; ratings-update
    // owns them from then on.
    problems.push(
      `${s.finals} games are already final — week-0 ratings are history now and ` +
        `ratings-update owns the current ones`,
    );
  }

  return { problems, notices };
}

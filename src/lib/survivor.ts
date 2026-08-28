/**
 * Survivor pools: one team a week, never the same team twice, wrong answer and
 * you are out (migration 0053).
 *
 * Everything in here is pure and derived. Nothing stores "eliminated" — a
 * standing is recomputed from the picks and the final scores on every read, so
 * a corrected score or a re-graded game moves the standings instead of leaving
 * a stale flag behind. See the migration's header for why that is the choice.
 *
 * ## The two rules that are easy to get wrong
 *
 * **A tie is a strike.** It is not a win, and a pool that treated it as one
 * would let an entrant survive a week they did not win. Rare in the NFL and
 * effectively impossible in CFB, but it is a real outcome and the code says so
 * rather than falling through to a default.
 *
 * **A missed week is a strike, but only once the week is closed.** Closed means
 * every game the pool could have picked has kicked off — not the first one. Our
 * picks lock per game (`make_survivor_pick`), the way `make_pick` does, so
 * somebody legitimately holding out for the Monday night game has not missed
 * anything on Sunday afternoon.
 */

import type { SeasonType } from "./season";

/**
 * `classic` is one pick a week, strikes and you're out. `extreme` (0082) is
 * any number of picks a week racing to `targetWins`, one losing pick and
 * you're out — and a missed week is NOT a strike there: classic needs that
 * rule or stalling would be a strategy, while in a race sitting a week out is
 * its own punishment.
 */
export type SurvivorFormat = "classic" | "extreme";

export interface SurvivorPool {
  groupId: string;
  seasonId: number;
  /** Null = the whole league. Matched against `teams.conference`. */
  conference: string | null;
  /** Wrong answers allowed before elimination. 1 = classic single elimination. */
  strikes: number;
  reuseTeams: boolean;
  startWeek: number;
  format: SurvivorFormat;
  /** The finish line of an extreme pool ("first to 100"). Null for classic. */
  targetWins: number | null;
}

export interface SurvivorPickRowView {
  userId: string;
  week: number;
  seasonType: SeasonType;
  gameId: number;
  teamId: number;
}

export interface SurvivorGameView {
  id: number;
  week: number;
  seasonType: SeasonType;
  status: string;
  startTs: string | null;
  homeTeamId: number;
  awayTeamId: number;
  homePoints: number | null;
  awayPoints: number | null;
}

/** What one week did to one entrant. */
export type SurvivorOutcome = "won" | "lost" | "tied" | "pending" | "missed";

/** A strike is anything that is neither a win nor still in progress. */
export const isStrike = (o: SurvivorOutcome): boolean =>
  o === "lost" || o === "tied" || o === "missed";

export interface SurvivorWeekResult {
  week: number;
  seasonType: SeasonType;
  outcome: SurvivorOutcome;
  teamId: number | null;
  gameId: number | null;
}

export interface SurvivorEntry {
  userId: string;
  name: string;
  /**
   * One row per pick (classic also logs pickless weeks as `missed`/`pending`
   * rows; extreme logs only actual picks, since an empty week is not an event
   * there). An extreme week can therefore contribute several rows.
   */
  weeks: SurvivorWeekResult[];
  strikes: number;
  /** Won picks. Classic reads it nowhere; extreme races on it. */
  wins: number;
  eliminated: boolean;
  /** The week the last strike landed in — what "Out (Week 4)" reads from. */
  eliminatedIn: { week: number; seasonType: SeasonType } | null;
  /** Crossed the extreme finish line (`targetWins`) without a strike. */
  finished: boolean;
  /** Teams already spent, in the order they were used. */
  usedTeamIds: number[];
  /** The first pick for the week being viewed, if any. */
  current: SurvivorWeekResult | null;
  /** Every pick for the week being viewed — extreme can hold several. */
  currentPicks: SurvivorWeekResult[];
}

/** How the picked team's game finished. `pending` until the game is final. */
export function pickOutcome(
  pick: Pick<SurvivorPickRowView, "teamId">,
  game: SurvivorGameView | undefined,
): SurvivorOutcome {
  if (!game || game.status !== "final") return "pending";
  if (game.homePoints === null || game.awayPoints === null) return "pending";
  const mine = pick.teamId === game.homeTeamId ? game.homePoints : game.awayPoints;
  const theirs = pick.teamId === game.homeTeamId ? game.awayPoints : game.homePoints;
  if (mine > theirs) return "won";
  if (mine < theirs) return "lost";
  return "tied";
}

const key = (w: { week: number; seasonType: SeasonType }): string => `${w.seasonType}:${w.week}`;

/**
 * Which weeks the pool has actually played, in order, and which of them are
 * closed for picking.
 *
 * Built from the games in scope rather than from a week list, so a pool that
 * starts in week 6 and a league whose season type changes mid-January both come
 * out right without a special case.
 */
export function poolWeeks(
  pool: SurvivorPool,
  games: SurvivorGameView[],
  now: Date = new Date(),
): Array<{ week: number; seasonType: SeasonType; closed: boolean }> {
  const byWeek = new Map<string, { week: number; seasonType: SeasonType; closed: boolean }>();
  for (const g of games) {
    if (g.seasonType === "preseason") continue;
    if (g.seasonType === "regular" && g.week < pool.startWeek) continue;
    const k = key(g);
    const kicked = g.startTs !== null && new Date(g.startTs) <= now;
    const prior = byWeek.get(k);
    if (!prior) byWeek.set(k, { week: g.week, seasonType: g.seasonType, closed: kicked });
    // Closed only when EVERY game in the week has kicked off — one Monday
    // nighter left keeps the week open.
    else prior.closed = prior.closed && kicked;
  }
  const order: Record<SeasonType, number> = { preseason: 0, regular: 1, postseason: 2 };
  return [...byWeek.values()].sort(
    (a, b) => order[a.seasonType] - order[b.seasonType] || a.week - b.week,
  );
}

/**
 * Every entrant's standing, in the order a pool reads: alive first, then by
 * fewest strikes, then by name. Eliminated members stay on the list — being out
 * is the format's headline event and hiding it would erase the game's history.
 */
export function survivorStandings(
  members: Array<{ userId: string; name: string }>,
  picks: SurvivorPickRowView[],
  games: SurvivorGameView[],
  pool: SurvivorPool,
  viewing: { week: number; seasonType: SeasonType },
  now: Date = new Date(),
): SurvivorEntry[] {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const weeks = poolWeeks(pool, games, now);
  const byUserWeek = new Map<string, Map<string, SurvivorPickRowView[]>>();
  for (const p of picks) {
    const mine = byUserWeek.get(p.userId) ?? new Map<string, SurvivorPickRowView[]>();
    const arr = mine.get(key(p)) ?? [];
    arr.push(p);
    mine.set(key(p), arr);
    byUserWeek.set(p.userId, mine);
  }

  const entries = members.map(({ userId, name }) => {
    const mine = byUserWeek.get(userId) ?? new Map<string, SurvivorPickRowView[]>();
    const results: SurvivorWeekResult[] = [];
    let strikes = 0;
    let wins = 0;
    let eliminatedIn: { week: number; seasonType: SeasonType } | null = null;

    for (const w of weeks) {
      // Classic holds one pick a week by rule; extreme any number. Ordered by
      // kickoff so an extreme week's log reads the way the weekend played out.
      const weekPicks = [...(mine.get(key(w)) ?? [])].sort((a, b) =>
        (gameById.get(a.gameId)?.startTs ?? "9999").localeCompare(
          gameById.get(b.gameId)?.startTs ?? "9999",
        ),
      );

      if (weekPicks.length === 0) {
        // A pickless week: a strike in classic once it closes, a non-event in
        // extreme — the race just goes on without you. The classic log records
        // it; the extreme log has nothing to record.
        if (pool.format === "classic") {
          const outcome: SurvivorOutcome = w.closed ? "missed" : "pending";
          results.push({
            week: w.week,
            seasonType: w.seasonType,
            outcome,
            teamId: null,
            gameId: null,
          });
          if (isStrike(outcome) && eliminatedIn === null) {
            strikes++;
            if (strikes >= pool.strikes) {
              eliminatedIn = { week: w.week, seasonType: w.seasonType };
            }
          }
        }
        continue;
      }

      for (const pick of weekPicks) {
        const outcome = pickOutcome(pick, gameById.get(pick.gameId));
        results.push({
          week: w.week,
          seasonType: w.seasonType,
          outcome,
          teamId: pick.teamId,
          gameId: pick.gameId,
        });
        // Strikes (and wins) stop accruing at elimination. Weeks after it are
        // still recorded — the history is the point — but an entrant who went
        // out in week 3 of a fifteen-week season should read "out (week 3)",
        // not "13 strikes", which is what counting every unpicked week
        // afterwards would produce.
        if (eliminatedIn === null) {
          if (outcome === "won") wins++;
          if (isStrike(outcome)) {
            strikes++;
            if (strikes >= pool.strikes) {
              eliminatedIn = { week: w.week, seasonType: w.seasonType };
            }
          }
        }
      }
    }

    const currentPicks = results.filter(
      (r) =>
        r.week === viewing.week && r.seasonType === viewing.seasonType && r.teamId !== null,
    );
    return {
      userId,
      name,
      weeks: results,
      strikes,
      wins,
      eliminated: eliminatedIn !== null,
      eliminatedIn,
      finished:
        pool.format === "extreme" &&
        pool.targetWins !== null &&
        eliminatedIn === null &&
        wins >= pool.targetWins,
      usedTeamIds: results.map((r) => r.teamId).filter((t): t is number => t !== null),
      current:
        results.find((r) => r.week === viewing.week && r.seasonType === viewing.seasonType) ??
        null,
      currentPicks,
    };
  });

  // Alive above out in both formats; inside that, extreme is a race and ranks
  // on wins, classic ranks on fewest strikes.
  return entries.sort(
    (a, b) =>
      Number(a.eliminated) - Number(b.eliminated) ||
      (pool.format === "extreme" ? b.wins - a.wins : 0) ||
      a.strikes - b.strikes ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Whether a team may be picked this week by this entrant.
 *
 * The three refusals are different sentences, not one disabled state: "already
 * used" is about the season, "kicked off" is about the clock, and "out of
 * scope" is about the pool's conference. A grid of identically greyed buttons
 * cannot tell you which of those you are looking at.
 */
export type PickBlock = "used" | "kicked" | "scope" | null;

export function blockReason(
  teamId: number,
  teamConference: string | null,
  game: SurvivorGameView,
  usedTeamIds: number[],
  pool: SurvivorPool,
  now: Date = new Date(),
): PickBlock {
  if (pool.conference !== null && teamConference !== pool.conference) return "scope";
  if (game.startTs === null || new Date(game.startTs) <= now) return "kicked";
  if (!pool.reuseTeams && usedTeamIds.includes(teamId)) return "used";
  return null;
}

/** "SEC · one strike" — the pool's rules in a caption. */
export function poolRulesLine(pool: SurvivorPool, sport: "cfb" | "nfl"): string {
  const scope = pool.conference ?? (sport === "nfl" ? "NFL" : "all of college football");
  const reuse = pool.reuseTeams ? "teams may repeat" : "each team once";
  if (pool.format === "extreme") {
    return `${scope} · first to ${pool.targetWins ?? "?"} wins · one loss and out · ${reuse}`;
  }
  const strikes = pool.strikes === 1 ? "one strike and out" : `${pool.strikes} strikes and out`;
  return `${scope} · ${strikes} · ${reuse}`;
}

/**
 * The teams an entrant has spent in every week *except* the one being viewed.
 *
 * `usedTeamIds` is the whole season including this week, and handing that to
 * `blockReason` labels your own current pick "already used" — a refusal the
 * database does not make. `make_survivor_pick` deliberately excludes the week
 * being written (0053), so re-picking the same team for the same week is the
 * no-op it looks like; the board has to agree with that or it tells you a rule
 * that isn't there.
 */
export function teamsSpentElsewhere(
  entry: Pick<SurvivorEntry, "weeks">,
  viewing: { week: number; seasonType: SeasonType },
): number[] {
  return entry.weeks
    .filter((w) => !(w.week === viewing.week && w.seasonType === viewing.seasonType))
    .map((w) => w.teamId)
    .filter((t): t is number => t !== null);
}

/** The word a finished week gets on the season log. */
export const OUTCOME_WORD: Record<SurvivorOutcome, string> = {
  won: "survived",
  lost: "lost",
  tied: "tied",
  missed: "no pick",
  pending: "pending",
};

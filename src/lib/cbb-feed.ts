/**
 * The cbbmodel pick feed → this database's rows. Pure.
 *
 * The college basketball model is not in this repo. It lives in
 * `chasevandiver/cbbmodel` (Barttorvik efficiencies → spread, total, win
 * probability), is graded there, and publishes a JSON feed
 * (`FEED_SCHEMA.md` in that repo, schema 1.0) that this app reads. Nothing
 * here prices a game; it only translates. So `DEFAULT_PARAMS` and the
 * backtest gate in AGENTS.md do not apply to these numbers — they are an
 * imported opinion, labelled with their own `model_version`, and their record
 * is the feed's to report.
 *
 * ## Sign conventions, which is the one thing here that can go silently wrong
 *
 *  - Spreads agree. The feed's `spread_home` is the home team's number,
 *    negative when the home team is favoured — exactly `line_snapshots.spread`
 *    and `predictions.spread`. No negation anywhere.
 *  - **Edges do not.** The feed's `edge.spread` is `market − model` (positive
 *    = the model likes the home side). This app's `predictions.edge` is
 *    `model − market` (negative = the model likes the home side; see
 *    `modelClv` and `modelSideOf`). So the feed's edge is never copied: it is
 *    recomputed here from the two spreads, in this app's direction, and the
 *    test pins a real record both ways round.
 *  - Win probability is 0–100 in the feed and 0–1 here.
 */

/** One side of the market as the feed states it. */
export interface FeedMarket {
  spread_home: number | null;
  total: number | null;
  /** Who the book favours: "USF -7.5" from ESPN, a full team name otherwise. */
  favorite?: string | null;
  bookmaker?: string | null;
  captured_at?: string | null;
}

export interface FeedRecord {
  id: string;
  sport: string;
  season: number;
  slate_date: string;
  game_id: string;
  start_time: string;
  status: "pending" | "final" | "no_result";
  home: { name: string; abbr: string | null };
  away: { name: string; abbr: string | null };
  model: {
    version: string | null;
    spread_home: number | null;
    total: number | null;
    home_score: number | null;
    away_score: number | null;
    home_win_prob: number | null;
    confidence: number | null;
    tempo?: number | null;
  };
  market: FeedMarket | null;
  closing: FeedMarket | null;
  edge: { value_rating: number | null; is_best_bet: boolean };
  bet: { side: "home" | "away" | "none" };
  tags: string[];
}

export interface FeedFile {
  schema_version: string;
  kind: string;
  sport: string;
  season: number;
  slate_date?: string;
  /** True on `slate-next.json`: a preview of a later day, not picks of record (CBB-14). */
  early?: boolean;
  generated_at: string;
  model: { name: string; version: string | null };
  records: FeedRecord[];
}

/**
 * The provider every feed line is stored under.
 *
 * One constant rather than the feed's `bookmaker`, deliberately. The feed
 * takes the first book that has a line (DraftKings, FanDuel, BetMGM, Caesars,
 * then ESPN's), so the book can differ between the pick-time line and a later
 * snapshot — and `line_consensus` means the latest snapshot PER PROVIDER. Two
 * provider names for one game would average this morning's FanDuel number
 * against tonight's DraftKings one and show a line nobody is hanging. Stored
 * under one name, the newest snapshot simply is the line, which is what "use
 * the spreads from the cbb model" means. The book is kept on the prediction's
 * `adjustments` for anyone who wants it.
 */
export const CBB_FEED_PROVIDER = "Courtside";
export const CBB_FEED_SOURCE = "cbbmodel";

/** `predictions.model_version` for a feed row — never parses as a CFB version. */
export function cbbModelVersion(version: string | null): string {
  return `cbb-${version ?? "unknown"}`;
}

export function isCbbModelVersion(modelVersion: string): boolean {
  return modelVersion.startsWith("cbb-");
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The schema major this reader understands. A 2.x feed is refused, not guessed at. */
export function feedIsReadable(file: Pick<FeedFile, "schema_version" | "sport" | "kind">): boolean {
  return file.sport === "cbb" && file.kind === "slate" && /^1\./.test(file.schema_version);
}

/**
 * Which side the feed's own `favorite` field names, or null when it cannot be
 * read. Two shapes reach here: ESPN's `details` ("USF -7.5", an abbreviation
 * and a number) and a full team name when the line came from The Odds API.
 */
function favoriteSide(rec: FeedRecord, fav: string | null | undefined): "home" | "away" | null {
  if (!fav) return null;
  const t = fav.trim();
  const eq = (a: string | null | undefined, b: string) =>
    !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
  const abbr = /^(.+?)\s+[+-]?\d+(?:\.\d+)?$/.exec(t)?.[1] ?? null;
  for (const name of [abbr, t]) {
    if (!name) continue;
    if (eq(rec.home.abbr, name) || eq(rec.home.name, name)) return "home";
    if (eq(rec.away.abbr, name) || eq(rec.away.name, name)) return "away";
  }
  return null;
}

/**
 * A market the importer will store, or null when its spread contradicts
 * itself.
 *
 * The feed states the line twice: the signed `spread_home`, and `favorite`.
 * They are written at different moments in that repo, and they have
 * disagreed — Saint Joseph's vs South Florida, 2026-11-11, published as home
 * −7.5 with South Florida (the AWAY side) named favourite, because ESPN
 * re-designated home and away on a neutral floor between two runs and the
 * earlier line was carried forward under the new designation. That bug is
 * fixed at its source, but an importer writing into an append-only table does
 * not get to assume its source is fixed.
 *
 * So this is `parseEventOdds`' rule (src/lib/espn.ts), for the same reason:
 * when two independent readings of one line disagree there is no way to tell
 * which is inverted, and the spread is dropped rather than stored possibly
 * backwards. The total survives — it has no side to get wrong. A favourite
 * that cannot be resolved to either team is no evidence against the line and
 * leaves it trusted.
 */
export function trustedMarket(rec: FeedRecord, mk: FeedMarket | null): FeedMarket | null {
  if (!mk) return null;
  if (mk.spread_home === null || mk.spread_home === 0) return mk;
  const side = favoriteSide(rec, mk.favorite);
  if (side === null) return mk;
  const signSays = mk.spread_home < 0 ? "home" : "away";
  return side === signSays ? mk : { ...mk, spread_home: null };
}

export interface FeedPrediction {
  game_id: number;
  model_version: string;
  frozen: boolean;
  spread: number;
  total: number | null;
  home_score: number | null;
  away_score: number | null;
  home_win_prob: number;
  cover_prob: null;
  vegas_spread: number | null;
  open_spread: number | null;
  edge: number | null;
  edge_flag: "EDGE" | "BIG_EDGE" | null;
  consensus_flag: false;
  adjustments: Record<string, unknown>;
}

/**
 * A feed record as a `predictions` row, or null when the model stated no
 * spread or no win probability (both are NOT NULL here, and a prediction
 * without them is not one).
 *
 * `frozen: true` always. The feed publishes a pick once, in the morning, and
 * never revises it — a rerun in that repo carries the original forward — so
 * every row it emits is already the receipt. `vegas_spread` is the pick-time
 * `market`, not `closing`: it is the line the model's edge was measured
 * against, which is what the grader's CLV compares the close to.
 *
 * The one exception is a record from `slate-next.json` (`early`, CBB-14): the
 * day-before preview, which the feed reprices at every snapshot and replaces
 * with the morning's pick. That is stored `frozen: false` — this table's
 * existing word for a price that is not a receipt — so the slate shows it,
 * the standing-row rule prefers the morning's frozen row the moment it
 * lands, and the grader, which settles frozen rows only, never grades it.
 *
 * Flags map the feed's own two tiers: its "best bet" (an edge inside the
 * band that repo found worth flagging) is this app's BIG_EDGE, and a "value"
 * play (edge ≥ 3) is EDGE. The thresholds are that model's, applied there.
 */
export function feedPrediction(rec: FeedRecord, opts: { early?: boolean } = {}): FeedPrediction | null {
  const gameId = Number(rec.game_id);
  const m = rec.model;
  if (!Number.isSafeInteger(gameId) || m.spread_home === null || m.home_win_prob === null) return null;
  const vegas = trustedMarket(rec, rec.market)?.spread_home ?? null;
  const edge = vegas === null ? null : r1(m.spread_home - vegas);
  return {
    game_id: gameId,
    model_version: cbbModelVersion(m.version),
    frozen: !opts.early,
    spread: m.spread_home,
    total: m.total,
    home_score: m.home_score,
    away_score: m.away_score,
    home_win_prob: Math.min(1, Math.max(0, m.home_win_prob / 100)),
    cover_prob: null,
    vegas_spread: vegas,
    open_spread: vegas,
    edge,
    edge_flag:
      edge === null || edge === 0
        ? null
        : rec.edge.is_best_bet
          ? "BIG_EDGE"
          : rec.tags.includes("value")
            ? "EDGE"
            : null,
    consensus_flag: false,
    adjustments: {
      source: CBB_FEED_SOURCE,
      slate_date: rec.slate_date,
      confidence: m.confidence,
      tempo: m.tempo ?? null,
      bookmaker: rec.market?.bookmaker ?? null,
      ...(opts.early ? { early: true } : {}),
    },
  };
}

/**
 * Whether `slate-next.json` is a preview this importer should store: a
 * readable slate dated strictly after the published one. The feed removes the
 * file once its day is published, but a cached copy can outlive that, and a
 * stale preview stored after the morning's pick would be yesterday's opinion
 * arriving late.
 */
export function nextSlateIsAhead(
  published: Pick<FeedFile, "slate_date">,
  next: Pick<FeedFile, "schema_version" | "sport" | "kind" | "slate_date">,
): boolean {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!feedIsReadable(next) || !next.slate_date || !iso.test(next.slate_date)) return false;
  if (!published.slate_date || !iso.test(published.slate_date)) return false;
  return next.slate_date > published.slate_date;
}

/** What makes a stored prediction stale against the feed's. */
export function predictionChanged(
  stored: { spread: number | string; total: number | string | null; vegas_spread: number | string | null } | undefined,
  next: Pick<FeedPrediction, "spread" | "total" | "vegas_spread">,
): boolean {
  if (!stored) return true;
  const n = (v: number | string | null) => (v === null ? null : Number(v));
  return (
    n(stored.spread) !== next.spread ||
    n(stored.total) !== next.total ||
    n(stored.vegas_spread) !== next.vegas_spread
  );
}

export interface FeedSnapshot {
  game_id: number;
  provider: string;
  source: string;
  spread: number | null;
  spread_open: number | null;
  total: number | null;
  total_open: number | null;
  ml_home: null;
  ml_away: null;
  captured_at: string;
}

/**
 * The feed's current line on a game as a `line_snapshots` row, or null when
 * it has none.
 *
 * Current means `closing` when the feed has snapshotted since the pick, else
 * the pick-time `market`. The pick-time line doubles as the opener, so the
 * card's movement arrow reads "since the model picked".
 *
 * `captured_at` matters more than it looks: the grader's closing line is the
 * last snapshot BEFORE tip. The feed stamps its snapshots; the pick-time
 * line carries no stamp, so it takes `now` — unless the game has already
 * tipped, where "now" would put a pregame line after kickoff and the grader
 * would ignore it. Then it is stamped a minute before tip, which is the
 * latest moment it can honestly have been the line.
 */
export function feedSnapshot(rec: FeedRecord, now: string): FeedSnapshot | null {
  const gameId = Number(rec.game_id);
  if (!Number.isSafeInteger(gameId)) return null;
  const market = trustedMarket(rec, rec.market);
  const cur = trustedMarket(rec, rec.closing) ?? market;
  if (!cur || (cur.spread_home === null && cur.total === null)) return null;
  const tip = Date.parse(rec.start_time);
  const stamped = cur.captured_at ? Date.parse(cur.captured_at) : NaN;
  const nowMs = Date.parse(now);
  let at = Number.isFinite(stamped) ? stamped : nowMs;
  if (Number.isFinite(tip) && at >= tip) at = tip - 60_000;
  return {
    game_id: gameId,
    provider: CBB_FEED_PROVIDER,
    source: CBB_FEED_SOURCE,
    spread: cur.spread_home,
    spread_open: market?.spread_home ?? cur.spread_home,
    total: cur.total,
    total_open: market?.total ?? cur.total,
    ml_home: null,
    ml_away: null,
    captured_at: new Date(at).toISOString(),
  };
}

/** Append only when the number moved — the table is append-only and a row per
 *  poll per game would be thousands of copies of the same line by March. */
export function snapshotChanged(
  stored: { spread: number | string | null; total: number | string | null } | undefined,
  next: Pick<FeedSnapshot, "spread" | "total">,
): boolean {
  if (!stored) return true;
  const n = (v: number | string | null) => (v === null ? null : Number(v));
  return n(stored.spread) !== next.spread || n(stored.total) !== next.total;
}

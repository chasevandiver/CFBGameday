/**
 * College basketball model + lines, from the cbbmodel pick feed.
 *
 * The model is not in this repo. `chasevandiver/cbbmodel` prices the day's
 * games every morning and snapshots the market seven times through the day;
 * its `export_feed.py` writes `public/feed/cbb/slate.json`, which its Vercel
 * deployment serves. This job reads that one file and writes:
 *
 *   - `predictions`    one frozen row per game (the model's spread, total,
 *                      projected score and win probability, and its edge
 *                      against the pick-time line) — appended once, and again
 *                      only if the feed's numbers for the game change;
 *   - `line_snapshots` the feed's current line, appended only when it moves.
 *
 * It then reads `slate-next.json`, when the feed has one, for the next day's
 * preview (CBB-14): the same two tables, with the predictions unfrozen.
 *
 * Everything about the translation — sign conventions, the self-contradiction
 * guard, when a row counts as changed — is pure and lives in
 * `src/lib/cbb-feed.ts`, tested against real feed records.
 *
 * A stale or unreachable feed is not an error worth a red run: the slate
 * simply shows the games without a model line, which is the truth. A feed
 * this reader cannot parse IS — that is a schema change and somebody should
 * look.
 *
 * Usage: npx tsx scripts/cbb-sync-feed.ts [--dry-run] [--url <slate.json>]
 */

import {
  CBB_FEED_PROVIDER,
  feedIsReadable,
  feedPrediction,
  feedSnapshot,
  nextSlateIsAhead,
  predictionChanged,
  snapshotChanged,
  type FeedFile,
} from "../src/lib/cbb-feed";
import {
  buildCbbModelStats,
  type FeedGradedRecord,
  type FeedIndex,
} from "../src/lib/cbb-model-stats";
import { cbbSeasonIdFromEndYear } from "../src/lib/league";
import { chunk, createSink, dropUnknownGames } from "./lib/ingest";
import { recordJobRun } from "./lib/jobs-core";

const DEFAULT_URL = "https://cbbmodel.vercel.app/feed/cbb/slate.json";

function feedUrl(): string {
  const i = process.argv.indexOf("--url");
  return (i > -1 ? process.argv[i + 1] : undefined) ?? process.env.CBB_FEED_URL ?? DEFAULT_URL;
}

async function fetchFeed(url: string): Promise<FeedFile | null> {
  // One jittered retry, hard timeout — the cfbd.ts/espn.ts shape.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as FeedFile;
      if (res.status < 500 && res.status !== 429) {
        console.warn(`  feed answered ${res.status} — nothing to import`);
        return null;
      }
    } catch (err) {
      if (attempt > 0) {
        console.warn(`  feed unreachable: ${(err as Error).message}`);
        return null;
      }
    }
    if (attempt > 0) return null;
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
  }
}

async function main() {
  const { sink, db } = createSink();
  const body = () => run(sink, db);
  const result = db ? await recordJobRun(db, "cbb-sync-feed", body) : await body();
  console.log("cbb-sync-feed", JSON.stringify(result));
}

type Sink = ReturnType<typeof createSink>["sink"];
type Db = ReturnType<typeof createSink>["db"];

async function run(sink: Sink, db: Db): Promise<Record<string, unknown>> {
  const url = feedUrl();
  const feed = await fetchFeed(url);
  if (!feed) return { skipped: "feed_unavailable" };
  if (!feedIsReadable(feed)) {
    throw new Error(
      `cbbmodel feed is not a schema-1.x cbb slate (schema ${feed.schema_version}, ` +
        `sport ${feed.sport}, kind ${feed.kind}) — the importer needs updating before it writes`,
    );
  }
  const seasonId = cbbSeasonIdFromEndYear(feed.season);
  const slate = await importSlate(sink, db, feed, false);
  const next = await importNextSlate(sink, db, url, feed);
  if (!db) return { ...slate, next };

  const stats = await syncModelStats(db, url, seasonId);
  return {
    slate_date: feed.slate_date ?? null,
    generated_at: feed.generated_at,
    ...slate,
    next,
    stats,
  };
}

/**
 * Tomorrow's slate, a day early (CBB-14).
 *
 * The feed publishes `slate-next.json` beside `slate.json` from late morning:
 * the next day's games priced on today's ratings and whatever lines are up,
 * repriced at every snapshot. It is a preview. Its rows are stored unfrozen
 * (see `feedPrediction`), so the morning's pick replaces them on the card and
 * nothing here is ever graded.
 *
 * Best-effort, like the stats: the file is absent for the hours between the
 * morning run and the first snapshot, and a missing preview is the state the
 * app was in before this existed.
 */
async function importNextSlate(sink: Sink, db: Db, slateUrl: string, published: FeedFile): Promise<unknown> {
  try {
    const next = await fetchFeed(slateUrl.slice(0, slateUrl.lastIndexOf("/") + 1) + "slate-next.json");
    if (!next) return "none";
    if (!nextSlateIsAhead(published, next)) return `stale (${next.slate_date ?? "undated"})`;
    return { slate_date: next.slate_date, ...(await importSlate(sink, db, next, true)) };
  } catch (err) {
    console.warn(`  next slate skipped: ${(err as Error).message}`);
    return `skipped: ${(err as Error).message}`.slice(0, 160);
  }
}

/**
 * One slate file → `predictions` and `line_snapshots`. `early` marks the
 * preview: unfrozen rows, compared against the last unfrozen row, and never
 * written for a game that already carries the pick of record.
 */
async function importSlate(sink: Sink, db: Db, feed: FeedFile, early: boolean): Promise<Record<string, unknown>> {
  const seasonId = cbbSeasonIdFromEndYear(feed.season);
  const now = new Date().toISOString();
  console.log(
    `CBB feed ${feed.slate_date ?? "?"}${early ? " (early)" : ""} · ${feed.records.length} records · ` +
      `model ${feed.model.version} · generated ${feed.generated_at}`,
  );

  const allPreds = feed.records.flatMap((r) => {
    const p = feedPrediction(r, { early });
    return p ? [{ ...p, season_id: seasonId }] : [];
  });
  const allSnaps = feed.records.flatMap((r) => {
    const s = feedSnapshot(r, now);
    return s ? [s] : [];
  });
  // A record the guard stripped of its spread — counted, so a feed that
  // starts contradicting itself wholesale shows up in job_runs.detail.
  const distrusted = feed.records.filter(
    (r) => r.market?.spread_home != null && feedPrediction(r)?.vegas_spread === null,
  ).length;

  if (!db) {
    await sink.insert("predictions", allPreds);
    await sink.insert("line_snapshots", allSnaps);
    return { records: feed.records.length, predictions: allPreds.length, snapshots: allSnaps.length, distrusted };
  }

  // Only games this database carries, and only basketball ones: the feed
  // prices what Barttorvik rates and the schedule is ESPN's, so the two
  // disagree at the edges, and a foreign id would fail the whole batch on its
  // foreign key (the lesson `dropUnknownGames` was written from).
  const ids = [...new Set([...allPreds, ...allSnaps].map((r) => r.game_id))];
  const known = new Set<number>();
  for (const batch of chunk(ids, 300)) {
    const { data, error } = await db
      .from("games")
      .select("id")
      .in("id", batch)
      .eq("season_id", seasonId)
      .eq("sport", "cbb");
    if (error) throw new Error(`games read: ${error.message}`);
    for (const g of (data ?? []) as Array<{ id: number }>) known.add(g.id);
  }
  const preds = dropUnknownGames(allPreds, known);
  const snaps = dropUnknownGames(allSnaps, known);
  if (preds.dropped.length > 0) {
    console.log(`  ${preds.dropped.length} feed games not on the schedule yet: ${preds.dropped.join(", ")}`);
  }

  // What is already stored, newest first, so each game's first row is its
  // standing one. A day's slate is a few hundred rows at most. Frozen and
  // unfrozen rows are kept apart: the morning's pick is always appended over
  // a preview, and a preview is compared only with the preview before it.
  type StoredPred = { spread: string; total: string | null; vegas_spread: string | null };
  const storedPred = new Map<number, StoredPred>();
  const storedEarly = new Map<number, StoredPred>();
  const storedSnap = new Map<number, { spread: string | null; total: string | null }>();
  for (const batch of chunk([...known], 300)) {
    const [p, s] = await Promise.all([
      db
        .from("predictions")
        .select("game_id, spread, total, vegas_spread, frozen, created_at")
        .in("game_id", batch)
        .order("created_at", { ascending: false })
        .limit(5000),
      db
        .from("line_snapshots")
        .select("game_id, spread, total, captured_at")
        .in("game_id", batch)
        .eq("provider", CBB_FEED_PROVIDER)
        .order("captured_at", { ascending: false })
        .limit(5000),
    ]);
    if (p.error) throw new Error(`predictions read: ${p.error.message}`);
    if (s.error) throw new Error(`snapshots read: ${s.error.message}`);
    for (const r of (p.data ?? []) as Array<StoredPred & { game_id: number; frozen: boolean }>) {
      const into = r.frozen ? storedPred : storedEarly;
      if (!into.has(r.game_id)) into.set(r.game_id, r);
    }
    for (const r of (s.data ?? []) as Array<{ game_id: number; spread: string | null; total: string | null }>)
      if (!storedSnap.has(r.game_id)) storedSnap.set(r.game_id, r);
  }

  const newPreds = preds.kept.filter((p) =>
    early
      ? !storedPred.has(p.game_id) && predictionChanged(storedEarly.get(p.game_id), p)
      : predictionChanged(storedPred.get(p.game_id), p),
  );
  const newSnaps = snaps.kept.filter((s) => snapshotChanged(storedSnap.get(s.game_id), s));
  for (const batch of chunk(newPreds, 500)) await sink.insert("predictions", batch);
  for (const batch of chunk(newSnaps, 500)) await sink.insert("line_snapshots", batch);

  console.log(`  ${newPreds.length} predictions, ${newSnaps.length} snapshots appended`);
  return {
    records: feed.records.length,
    predictions: newPreds.length,
    snapshots: newSnaps.length,
    unknown_games: preds.dropped.length,
    ...(distrusted ? { distrusted } : {}),
  };
}

/**
 * The model's own record → `cbb_model_stats` (CBB-16).
 *
 * Two more files from the same host: `index.json` for the season summary and
 * the season file for the per-day record. Best-effort by design — the picks
 * and lines above are what a slate card is; a stats row a few hours stale is
 * a stats row, and a failure here must not turn a successful import red. The
 * outcome is reported in `job_runs.detail` so a run that keeps skipping is
 * visible.
 */
async function syncModelStats(
  db: NonNullable<ReturnType<typeof createSink>["db"]>,
  slateUrl: string,
  seasonId: number,
): Promise<string> {
  try {
    const base = slateUrl.slice(0, slateUrl.lastIndexOf("/") + 1);
    const get = async <T>(file: string): Promise<T> => {
      const res = await fetch(base + file, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${file} answered ${res.status}`);
      return (await res.json()) as T;
    };
    const index = await get<FeedIndex>("index.json");
    // The file name comes from the feed; keep it to a bare file name so a
    // malformed index cannot point this fetch somewhere else.
    if (!/^[\w.-]+\.json$/.test(index.files?.season ?? "")) throw new Error("index names no season file");
    const season = await get<{ records: FeedGradedRecord[] }>(index.files.season);
    const payload = buildCbbModelStats(index, season.records ?? []);
    const { error } = await db
      .from("cbb_model_stats")
      .upsert({ season_id: seasonId, payload, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return `ok ${payload.ats.w}-${payload.ats.l}`;
  } catch (err) {
    console.warn(`  model stats skipped: ${(err as Error).message}`);
    return `skipped: ${(err as Error).message}`.slice(0, 160);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

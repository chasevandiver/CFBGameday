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
  predictionChanged,
  snapshotChanged,
  type FeedFile,
} from "../src/lib/cbb-feed";
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

async function run(
  sink: ReturnType<typeof createSink>["sink"],
  db: ReturnType<typeof createSink>["db"],
): Promise<Record<string, unknown>> {
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
  const now = new Date().toISOString();
  console.log(
    `CBB feed ${feed.slate_date ?? "?"} · ${feed.records.length} records · ` +
      `model ${feed.model.version} · generated ${feed.generated_at}`,
  );

  const allPreds = feed.records.flatMap((r) => {
    const p = feedPrediction(r);
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
  // standing one. A day's slate is a few hundred rows at most.
  const storedPred = new Map<number, { spread: string; total: string | null; vegas_spread: string | null }>();
  const storedSnap = new Map<number, { spread: string | null; total: string | null }>();
  for (const batch of chunk([...known], 300)) {
    const [p, s] = await Promise.all([
      db
        .from("predictions")
        .select("game_id, spread, total, vegas_spread, created_at")
        .in("game_id", batch)
        .eq("frozen", true)
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
    for (const r of (p.data ?? []) as Array<{ game_id: number; spread: string; total: string | null; vegas_spread: string | null }>)
      if (!storedPred.has(r.game_id)) storedPred.set(r.game_id, r);
    for (const r of (s.data ?? []) as Array<{ game_id: number; spread: string | null; total: string | null }>)
      if (!storedSnap.has(r.game_id)) storedSnap.set(r.game_id, r);
  }

  const newPreds = preds.kept.filter((p) => predictionChanged(storedPred.get(p.game_id), p));
  const newSnaps = snaps.kept.filter((s) => snapshotChanged(storedSnap.get(s.game_id), s));
  for (const batch of chunk(newPreds, 500)) await sink.insert("predictions", batch);
  for (const batch of chunk(newSnaps, 500)) await sink.insert("line_snapshots", batch);

  console.log(`  ${newPreds.length} predictions, ${newSnaps.length} snapshots appended`);
  return {
    slate_date: feed.slate_date ?? null,
    generated_at: feed.generated_at,
    records: feed.records.length,
    predictions: newPreds.length,
    snapshots: newSnaps.length,
    unknown_games: preds.dropped.length,
    ...(distrusted ? { distrusted } : {}),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

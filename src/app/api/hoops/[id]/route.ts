import { NextResponse } from "next/server";
import { espnCbb } from "../../../../lib/espn";
import { parseHoopsBox, type HoopsBox } from "../../../../lib/espn-cbb";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * One college basketball game's box score — team shooting, fouls by half,
 * points by half, players — for the game page (CBB-10).
 *
 * ## The one place a request reaches ESPN, and why
 *
 * `src/lib/espn.ts` states the rule: pages never call the feed, jobs do, and
 * jobs write to Postgres. This route is the deliberate exception (the fantasy
 * route is the precedent), and the reason is arithmetic. A box score lives in
 * ESPN's per-game `/summary`, ~1 MB a call. Ingesting it would mean one call
 * per live game per tick — sixty games on a Saturday, twice a minute — to
 * keep fresh a table that is read only when somebody opens a game. Fetching
 * when a game page is actually open costs one call per open game per 20
 * seconds, which is nothing, and stores nothing that would then need pruning.
 *
 * The bonus is why this cannot ride the scoreboard instead: it needs team
 * fouls per half, and the scoreboard carries no fouls at all.
 *
 * ## What keeps it cheap and closed
 *
 *  - The id must be a basketball game THIS database carries. Without that the
 *    route would be an open, unauthenticated proxy onto ESPN for any event id
 *    anyone cared to type.
 *  - Responses are memoised per warm instance: 20 seconds while a game can
 *    still move, an hour once it is final. Ten people watching one game are
 *    one upstream call, not ten.
 *  - An upstream failure serves the last good box when there is one. A stale
 *    box score is a box score; a blank section mid-game is a broken page.
 */
const LIVE_TTL_MS = 20_000;
const FINAL_TTL_MS = 3_600_000;
const MAX_ENTRIES = 300;

const cache = new Map<number, { at: number; ttl: number; box: HoopsBox | null }>();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isSafeInteger(gameId) || gameId <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const hit = cache.get(gameId);
  if (hit && Date.now() - hit.at < hit.ttl) {
    return NextResponse.json({ box: hit.box }, { headers: { "cache-control": "no-store" } });
  }

  const supabase = await createClient();
  const { data: game } = await supabase
    .from("games")
    .select("id, status, sport")
    .eq("id", gameId)
    .maybeSingle();
  const row = game as { id: number; status: string; sport: string } | null;
  if (!row || row.sport !== "cbb") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Nothing to show before tip, and nothing worth a call to find that out.
  if (row.status !== "in_progress" && row.status !== "final") {
    return NextResponse.json({ box: null }, { headers: { "cache-control": "no-store" } });
  }

  let box: HoopsBox | null;
  try {
    box = parseHoopsBox(await espnCbb.summary(gameId));
  } catch {
    // Serve the last good one rather than blanking the section mid-game.
    return NextResponse.json(
      { box: hit?.box ?? null, stale: true },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (cache.size >= MAX_ENTRIES) {
    // Oldest first: Map iterates in insertion order and entries are re-set on
    // every refresh, so the head is whichever game nobody has asked about.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(gameId);
  cache.set(gameId, {
    at: Date.now(),
    ttl: row.status === "final" ? FINAL_TTL_MS : LIVE_TTL_MS,
    box,
  });
  return NextResponse.json({ box }, { headers: { "cache-control": "no-store" } });
}

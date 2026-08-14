// NFL live-score pull — the database's own 30-second refresh.
//
// Invoked by pg_cron + pg_net every 30 seconds (migration 0043). Fetches
// ESPN's public scoreboard and patches the live columns of stored NFL games,
// mirroring scripts/lib/jobs-core.ts applyScoreboard: only rows whose live
// state actually changed are written, so realtime fan-out stays no-op-diffed.
// An idle gate runs first — no live or imminent NFL game means no ESPN call
// and no writes, so the year-round schedule costs one cheap query per tick.
//
// verify_jwt is OFF deliberately: the function takes no input, reads only
// ESPN's public feed, writes only via its own server-side service key, and
// diffs before writing — an unauthenticated caller can only cause a refresh
// that was about to happen anyway.
//
// This exists because the GitHub Actions scheduler proved unreliable exactly
// when it mattered (2026-08-13: preseason kicks with Actions stalled). The
// Actions loop still runs and writes the same values; the two coexist because
// both diff before writing. Deployed via the Supabase API; this file is the
// source of truth — redeploy after editing.

import { createClient } from "npm:@supabase/supabase-js@2";

type Patch = {
  status: string;
  home_points: number | null;
  away_points: number | null;
  current_period: number | null;
  current_clock: string | null;
  current_situation: string | null;
  last_play: string | null;
  possession: string | null;
};

Deno.serve(async () => {
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Idle gate — same shape as the loop's activity() check.
  const now = Date.now();
  const { data: active } = await db
    .from("games")
    .select("id")
    .eq("sport", "nfl")
    .or(
      `status.eq.in_progress,and(status.eq.scheduled,start_ts.gte.${new Date(now - 4 * 3600_000).toISOString()},start_ts.lte.${new Date(now + 15 * 60_000).toISOString()})`,
    )
    .limit(1);
  if (!active || active.length === 0) {
    return new Response("idle", { status: 200 });
  }

  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) return new Response(`espn ${res.status}`, { status: 200 });
  const board = await res.json();

  const patches = new Map<number, Patch>();
  for (const e of board.events ?? []) {
    const c = e.competitions?.[0];
    if (!c) continue;
    const state = c.status?.type?.state;
    if (state !== "in" && state !== "post") continue;
    const home = (c.competitors ?? []).find((x: any) => x.homeAway === "home");
    const away = (c.competitors ?? []).find((x: any) => x.homeAway === "away");
    if (!home || !away) continue;
    const status = state === "post" ? "final" : "in_progress";
    const inP = status === "in_progress";
    const sit = c.situation ?? {};
    const points = (x: any) => {
      const n = Number(x?.score);
      return Number.isFinite(n) ? n : null;
    };
    patches.set(Number(e.id), {
      status,
      home_points: points(home),
      away_points: points(away),
      current_period: inP ? (c.status?.period ?? null) : null,
      current_clock: inP ? (c.status?.displayClock ?? null) : null,
      // long form first — it carries the spot ("2nd & 10 at GB 31"), which is
      // what the card's field strip parses. Mirrors src/lib/espn.ts.
      current_situation: inP
        ? (sit.downDistanceText ?? sit.shortDownDistanceText ?? null)
        : null,
      last_play: inP ? (sit.lastPlay?.text ?? null) : null,
      possession:
        inP && sit.possession
          ? sit.possession === home.team?.id
            ? "home"
            : sit.possession === away.team?.id
              ? "away"
              : null
          : null,
    });
  }
  if (patches.size === 0) return new Response("no active espn games", { status: 200 });

  // One read of what's stored, so unchanged games cost zero writes.
  const ids = [...patches.keys()];
  const { data: stored, error: readErr } = await db
    .from("games")
    .select(
      "id, status, home_points, away_points, current_period, current_clock, current_situation, last_play, possession",
    )
    .in("id", ids)
    .eq("sport", "nfl");
  if (readErr) return new Response(`read failed: ${readErr.message}`, { status: 200 });

  const lines: string[] = [];
  let updated = 0;
  for (const row of stored ?? []) {
    const p = patches.get(row.id)!;
    const same = (Object.keys(p) as Array<keyof Patch>).every(
      (k) => (row as any)[k] === p[k],
    );
    if (same) continue;
    const { error } = await db
      .from("games")
      .update(p)
      .eq("id", row.id)
      .eq("sport", "nfl");
    if (!error) {
      updated++;
      lines.push(
        `${row.id} ${p.status} ${p.away_points}-${p.home_points} Q${p.current_period ?? "F"} ${p.current_clock ?? ""}`,
      );
    } else {
      lines.push(`${row.id} ERROR ${error.message}`);
    }
  }
  return new Response(
    `updated ${updated}/${stored?.length ?? 0}\n` + lines.join("\n"),
    { status: 200 },
  );
});

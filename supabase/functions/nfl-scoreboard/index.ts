// NFL live-score pull — the database's own 10-second refresh.
//
// Invoked by pg_cron + pg_net every 10 seconds (migration 0044, which replaced
// 0043's 30s). Fetches ESPN's public scoreboard and patches the live columns
// of stored NFL games, mirroring scripts/lib/jobs-core.ts applyScoreboard:
// only rows whose live state actually changed are written, so realtime fan-out
// stays no-op-diffed.
//
// 0044 moved the real gate into the cron command — `net.http_post` sits behind
// a `where exists (...)`, so this function is invoked only while a game is
// live or imminent and an idle night costs no invocation at all. The idle gate
// below stays as defence in depth, since the function remains publicly
// invokable.
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

/* Mirror of src/lib/live-play.ts — see there for why. A TV timeout is not a
   play and must not erase the one that is; almost every score is followed
   straight away by one, so the plays this used to overwrite were the field
   goal, the extra point and the touchdown. Deny-list, so an unrecognised type
   counts as a play and shows up rather than vanishing. This file is standalone
   Deno and cannot import from src/, so the list is duplicated deliberately;
   the unit tests over there cover the shared logic. */
const NON_PLAY_TYPES = new Set([
  "official timeout",
  "timeout",
  "two-minute warning",
  "two minute warning",
  "end period",
  "end of period",
  "end of half",
  "end of game",
  "end of regulation",
  "coin toss",
]);
const NON_PLAY_TEXT =
  /^\s*(official\s+timeout|timeout\s*#?\d*(\s+by\b)?|two[-\s]minute\s+warning|end\s+(of\s+)?(the\s+)?(\d+(st|nd|rd|th)\s+)?(quarter|period|half|game|regulation)|coin\s+toss)\b/i;

function isRealPlay(text: string | null, type: string | null): boolean {
  if (!text || !text.trim()) return false;
  if (type && type.trim()) return !NON_PLAY_TYPES.has(type.trim().toLowerCase());
  return !NON_PLAY_TEXT.test(text);
}

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

  /* LIVE-1, 2026-08-20. `Accept: application/json` mirrors src/lib/espn.ts:53,
     which is the client that has always worked. This one sent no headers at
     all and ESPN answered 403 to every single call — 408 of them during the
     Texans/Raiders preseason opener, which was this path's first live game.
     The whole 10-second refresh had never once succeeded.

     The header alone was NOT enough — that was the first attempt and it still
     403'd, which is how the UA below came to be tested. Both are kept: Accept
     because it mirrors the working client, the UA because it is what actually
     changed the answer. Origin was the other hypothesis and it is ruled out —
     Supabase's egress is fine, ESPN just refuses `Deno/x.y.z`. */
  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
    {
      headers: {
        Accept: "application/json",
        // Deno's default UA is `Deno/x.y.z`. The Actions loop, which has
        // never been refused, runs on Node's global fetch and sends its own
        // plain UA — so an identifiable client string is the remaining
        // difference between the two callers worth testing. If this is still
        // 403 the request is not the problem and the origin is.
        "User-Agent":
          "Mozilla/5.0 (compatible; TheSlate/1.0; +https://github.com/chasevandiver/CFBGameday)",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  /* Non-200, deliberately. This used to answer 200 with the failure in the
     body, so `cron.job_run_details` read `succeeded`, `net._http_response`
     read `200`, and a path that was doing nothing at all looked healthy
     everywhere anyone would check. Same shape as OPS-4 and OPS-19: a green
     run that did the wrong thing is indistinguishable from one that worked.
     502 = we are the gateway and the upstream refused us. */
  if (!res.ok) return new Response(`espn ${res.status}`, { status: 502 });
  const board = await res.json();

  /* LIVE-3. This path pulled successfully — stamped whether or not anything
     below changes, because "nothing changed" and "nothing ran" are the two
     states this whole row exists to tell apart. The Actions loop reads this
     during live games and pages when it goes quiet, which is the alarm that
     was missing while this function spent a whole game returning 403. */
  await db
    .from("live_heartbeat")
    .upsert({ source: "edge-10s", beat_at: new Date().toISOString() }, { onConflict: "source" });

  const patches = new Map<number, Patch>();
  // the raw play + its ESPN type, kept aside so the stored row can win below
  const plays = new Map<number, { text: string | null; type: string | null }>();
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
    plays.set(Number(e.id), {
      text: inP ? (sit.lastPlay?.text ?? null) : null,
      type: inP ? (sit.lastPlay?.type?.text ?? null) : null,
    });
  }
  // 200: healthy. Our gate says a game is live or imminent and ESPN has not
  // put it on the board yet — normal in the minutes before kickoff, and not a
  // failure to page anyone about.
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
  // Our own database refusing a read is a fault on this side, not upstream.
  if (readErr) return new Response(`read failed: ${readErr.message}`, { status: 500 });

  const lines: string[] = [];
  let updated = 0;
  for (const row of stored ?? []) {
    const p = { ...patches.get(row.id)! };
    // A timeout keeps whatever real play is already stored, so the diff below
    // sees no change and nothing fans out for a play that did not happen.
    const lp = plays.get(row.id);
    if (p.status === "in_progress" && lp && !isRealPlay(lp.text, lp.type)) {
      p.last_play = row.last_play;
    }
    const same = (Object.keys(p) as Array<keyof Patch>).every(
      (k) => (row as any)[k] === p[k],
    );
    if (same) continue;
    /* LIVE-4, mirroring scoreboardPatch: stamped after the diff decides, never
       as part of it, and only when the play is genuinely new — a play kept
       through a timeout keeps the time it actually arrived. */
    const write: Patch & { last_play_at?: string } = { ...p };
    if (p.last_play && p.last_play !== row.last_play) {
      write.last_play_at = new Date().toISOString();
    }
    const { error } = await db
      .from("games")
      .update(write)
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

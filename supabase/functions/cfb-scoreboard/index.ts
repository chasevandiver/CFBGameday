// CFB live-score pull from ESPN — the database's own 30-second refresh, and
// the college slate's second feed (LIVE-11).
//
// Invoked by pg_cron + pg_net every 30 seconds (migration 0085), gated in the
// cron command so an idle night costs no invocation. Fetches ESPN's public
// college scoreboard (FBS group 80 and FCS group 81) and patches the live
// columns of stored CFB games, mirroring scripts/lib/jobs-core.ts
// applyScoreboard and the NFL function beside this one: only rows whose live
// state actually changed are written, so realtime fan-out stays no-op-diffed.
//
// Why this exists: Week 1 Saturday, 2026-09-06 00:31 UTC, with 25 games live,
// CFBD began answering 401 on `/scoreboard` and nothing else — the Tier 1+
// entitlement on the key had lapsed (the access probe confirmed every other
// endpoint still answering). The Actions loop kept running and kept failing
// every tick; the slate froze mid-third-quarter for half an hour before the
// owner noticed. NFL-13 recorded that CFB could not take this lane because
// "there is no ESPN id column to join a college board on". That turned out to
// be wrong: CFBD's game ids ARE ESPN's event ids (401860878 is CSU/WYO in
// both), so the same id joins both boards and this function is the NFL one
// with the sport, the URLs and the heartbeat source changed.
//
// Two writers, deliberately. The Actions loop still writes the same columns
// from CFBD when that works; both diff before writing, and the clock is
// normalised below to CFBD's `MM:SS` so the two never flip-flop a row over
// "8:00" versus "08:00". Finals flip here too, but GRADING does not — that
// stays with the loop's sweeps and the Sunday backstop, which read
// `status = 'final'` from this table regardless of who wrote it.
//
// verify_jwt is OFF deliberately, as for nfl-scoreboard: no input, a public
// feed, writes only via its own server-side key, diffs before writing — an
// unauthenticated caller can only cause a refresh that was about to happen.
// Deployed via the Supabase API; this file is the source of truth — redeploy
// after editing.

import { createClient } from "npm:@supabase/supabase-js@2";

/* Mirror of src/lib/live-play.ts — see there for why. Duplicated deliberately:
   this file is standalone Deno and cannot import from src/. */
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

/** ESPN says "8:00"; CFBD (and so every stored CFB row) says "08:00". */
function cfbdClock(display: string | null | undefined): string | null {
  if (!display) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(display.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : display;
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

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
// 80 = FBS, 81 = FCS. The slate carries both (LINE-1: 45 FCS games in Week 1).
const GROUPS = [80, 81];

Deno.serve(async () => {
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Idle gate — same shape as the loop's activity() check and 0085's cron gate.
  const now = Date.now();
  const { data: active } = await db
    .from("games")
    .select("id")
    .eq("sport", "cfb")
    .or(
      `status.eq.in_progress,and(status.eq.scheduled,start_ts.gte.${new Date(now - 4 * 3600_000).toISOString()},start_ts.lte.${new Date(now + 15 * 60_000).toISOString()})`,
    )
    .limit(1);
  if (!active || active.length === 0) {
    return new Response("idle", { status: 200 });
  }

  // Headers exactly as nfl-scoreboard sends them (LIVE-1): ESPN refuses
  // Deno's default UA with 403.
  const boards = await Promise.all(
    GROUPS.map((g) =>
      fetch(`${ESPN}?groups=${g}&limit=300`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; TheSlate/1.0; +https://github.com/chasevandiver/CFBGameday)",
        },
        signal: AbortSignal.timeout(10_000),
      }),
    ),
  );
  // Non-200 on any refusal, so cron.job_run_details and net._http_response
  // show a failing path as failing (see nfl-scoreboard for why).
  const refused = boards.find((r) => !r.ok);
  if (refused) return new Response(`espn ${refused.status}`, { status: 502 });
  const events: any[] = [];
  for (const r of boards) {
    const board = await r.json();
    events.push(...(board.events ?? []));
  }

  // LIVE-3: a completed pull, stamped whether or not anything changes.
  await db
    .from("live_heartbeat")
    .upsert({ source: "edge-cfb", beat_at: new Date().toISOString() }, { onConflict: "source" });

  const patches = new Map<number, Patch>();
  const plays = new Map<number, { text: string | null; type: string | null }>();
  for (const e of events) {
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
      current_clock: inP ? cfbdClock(c.status?.displayClock) : null,
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
  if (patches.size === 0) return new Response("no active espn games", { status: 200 });

  // One read of what's stored; ESPN games we do not carry drop out here.
  const ids = [...patches.keys()];
  const { data: stored, error: readErr } = await db
    .from("games")
    .select(
      "id, status, home_points, away_points, current_period, current_clock, current_situation, last_play, possession",
    )
    .in("id", ids)
    .eq("sport", "cfb");
  if (readErr) return new Response(`read failed: ${readErr.message}`, { status: 500 });

  const lines: string[] = [];
  let updated = 0;
  for (const row of stored ?? []) {
    const p = { ...patches.get(row.id)! };
    const lp = plays.get(row.id);
    if (p.status === "in_progress" && lp && !isRealPlay(lp.text, lp.type)) {
      p.last_play = row.last_play;
    }
    // A stored final is final: never let a stale ESPN "in" reopen a game the
    // loop already closed and graded.
    if (row.status === "final" && p.status !== "final") continue;
    const same = (Object.keys(p) as Array<keyof Patch>).every(
      (k) => (row as any)[k] === p[k],
    );
    if (same) continue;
    const write: Patch & { last_play_at?: string } = { ...p };
    if (p.last_play && p.last_play !== row.last_play) {
      write.last_play_at = new Date().toISOString();
    }
    const { error } = await db
      .from("games")
      .update(write)
      .eq("id", row.id)
      .eq("sport", "cfb");
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

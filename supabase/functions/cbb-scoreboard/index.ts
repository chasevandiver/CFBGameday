// College basketball live-score pull — the database's own 30-second refresh,
// and the only live writer the league has (CBB-3).
//
// Invoked by pg_cron + pg_net every 30 seconds (migration 0086), gated in the
// cron command so a night with no basketball costs no invocation. Fetches
// ESPN's public men's college basketball scoreboard — ONE call for the whole
// Division I night — and patches the live columns of stored CBB games. Only
// rows whose live state actually changed are written, so realtime fan-out
// stays no-op-diffed.
//
// What it writes that the football functions do not: `games.hoops`, the
// basketball-only live block — points by half, the current run, and ESPN's
// live win probability. What it does not write: `current_situation` and
// `possession`, which have no basketball meaning and stay null.
//
// ONE writer, unlike football. The Actions scoreboard loop does not carry
// basketball (0086 takes it out of the launcher's gate): the league is live
// most evenings from November to April, and holding a runner for every one of
// those hours is ~1,500 runner-hours a season for a job this function does in
// a quarter of a second. Grading is therefore not here either — a final flips
// in this function, and `launch_cbb_grade_if_needed` (0086) dispatches the
// grader when a finished game is carrying an open bet.
//
// The logic below mirrors src/lib/espn-cbb.ts (parseCbbEvent, isRealCbbPlay)
// and src/lib/cbb.ts (nextRun). This file is standalone Deno and cannot
// import from src/, so the rules are duplicated deliberately; the unit tests
// over there cover the shared logic. Change one, change the other.
//
// verify_jwt is OFF deliberately, as for the football functions: no input, a
// public feed, writes only via its own server-side key, diffs before writing —
// an unauthenticated caller can only cause a refresh that was about to happen.
// Deployed via the Supabase API; this file is the source of truth — redeploy
// after editing.

import { createClient } from "npm:@supabase/supabase-js@2";

type Run = { side: "home" | "away"; pts: number } | null;
type Hoops = { h: number[]; a: number[]; run: Run; wp: number | null };

type Patch = {
  status: string;
  home_points: number | null;
  away_points: number | null;
  current_period: number | null;
  current_clock: string | null;
  last_play: string | null;
  hoops: Hoops | null;
};

/* Mirror of isRealCbbPlay. A timeout or a substitution is not a play and must
   not erase the basket it follows; deny-list, so an unrecognised type shows. */
const NON_PLAY = /timeout|substitution|end period|end game|end of|jumpball|challenge|official/i;
function isRealPlay(text: string | null, type: string | null): boolean {
  if (!text || !text.trim()) return false;
  return !NON_PLAY.test(type && type.trim() ? type : text);
}

/* Mirror of nextRun. Built from score deltas because this sees a game every
   30 seconds, not every basket: one side scoring extends or starts a run;
   both sides scoring inside one tick is unorderable from the scores alone, so
   the last made basket decides, and without one the run is cleared. */
function nextRun(
  prev: Run,
  dh: number,
  da: number,
  lastScorer: { side: "home" | "away"; pts: number } | null,
): Run {
  if (dh < 0 || da < 0) return null;
  if (dh === 0 && da === 0) return prev;
  if (dh > 0 && da > 0) {
    return lastScorer && lastScorer.pts > 0 ? { side: lastScorer.side, pts: lastScorer.pts } : null;
  }
  const side = dh > 0 ? "home" : "away";
  const pts = dh > 0 ? dh : da;
  return prev && prev.side === side ? { side, pts: prev.pts + pts } : { side, pts };
}

function lineOf(c: any): number[] {
  return (c?.linescores ?? [])
    .map((l: any) => (typeof l?.value === "number" && Number.isFinite(l.value) ? Math.round(l.value) : null))
    .filter((v: number | null): v is number => v !== null);
}

/** Order-insensitive enough for the diff: both writers build keys in this order. */
function sameHoops(a: Hoops | null, b: Hoops | null): boolean {
  if (a === null || b === null) return a === b;
  const arr = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  const run =
    a.run === null || b.run === null
      ? a.run === b.run
      : a.run.side === b.run.side && a.run.pts === b.run.pts;
  return arr(a.h ?? [], b.h ?? []) && arr(a.a ?? [], b.a ?? []) && run && a.wp === b.wp;
}

const ESPN =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

Deno.serve(async () => {
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Idle gate — the same predicate as 0086's cron gate, kept as defence in
  // depth because the function stays publicly invokable.
  const now = Date.now();
  const { data: active } = await db
    .from("games")
    .select("id")
    .eq("sport", "cbb")
    .or(
      `status.eq.in_progress,and(status.eq.scheduled,start_ts.gte.${new Date(now - 4 * 3600_000).toISOString()},start_ts.lte.${new Date(now + 15 * 60_000).toISOString()})`,
    )
    .limit(1);
  if (!active || active.length === 0) {
    return new Response("idle", { status: 200 });
  }

  /* `groups=50` is Division I; without it ESPN returns the featured dozen and
     the rest of the night does not exist. `limit` has to clear a 150-game
     Saturday. No `dates`: ESPN's own "today" rolls over in the small hours
     Eastern, after the last West Coast game, which is exactly the window a
     live poller wants.

     Headers as the football functions send them (LIVE-1): ESPN refuses Deno's
     default UA with 403. */
  const pull = async (dates?: string): Promise<{ ok: boolean; status: number; events: any[] }> => {
    const res = await fetch(`${ESPN}?groups=50&limit=400${dates ? `&dates=${dates}` : ""}`, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; TheSlate/1.0; +https://github.com/chasevandiver/CFBGameday)",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, status: res.status, events: [] };
    const board = await res.json();
    return { ok: true, status: 200, events: board.events ?? [] };
  };
  const first = await pull();
  // Non-200 on a refusal, so cron.job_run_details and net._http_response show
  // a failing path as failing (see nfl-scoreboard for why).
  if (!first.ok) return new Response(`espn ${first.status}`, { status: 502 });

  // LIVE-3: a completed pull, stamped whether or not anything changes. This
  // is the row the watchdog reads to tell "nothing changed" from "nothing ran".
  await db
    .from("live_heartbeat")
    .upsert({ source: "edge-cbb", beat_at: new Date().toISOString() }, { onConflict: "source" });

  type Seen = {
    patch: Omit<Patch, "hoops">;
    h: number[];
    a: number[];
    wp: number | null;
    play: { text: string | null; type: string | null };
    lastScorer: { side: "home" | "away"; pts: number } | null;
  };
  const seen = new Map<number, Seen>();
  const ingest = (events: any[]) => {
    for (const e of events) {
      const c = e.competitions?.[0];
      if (!c) continue;
      const state = c.status?.type?.state;
      if (state !== "in" && state !== "post") continue;
      // Postponed and cancelled games arrive as state "post" too. They are the
      // daily sync's to mark; calling one "final" here would grade bets on a
      // game that was never played.
      const name = c.status?.type?.name ?? "";
      if (name === "STATUS_POSTPONED" || name === "STATUS_CANCELED" || name === "STATUS_FORFEIT") continue;
      const home = (c.competitors ?? []).find((x: any) => x.homeAway === "home");
      const away = (c.competitors ?? []).find((x: any) => x.homeAway === "away");
      if (!home || !away) continue;
      const status = state === "post" ? "final" : "in_progress";
      const inP = status === "in_progress";
      const lp = c.situation?.lastPlay ?? null;
      const points = (x: any) => {
        const n = Number(x?.score);
        return Number.isFinite(n) ? n : null;
      };
      const scoreValue = typeof lp?.scoreValue === "number" ? lp.scoreValue : 0;
      // `scoreValue` is the shot's worth even on a miss; the text says "makes".
      const made = inP && scoreValue > 0 && /\bmade\b|\bmakes\b/i.test(lp?.text ?? "");
      const scorerId = lp?.team?.id ?? null;
      const wp = lp?.probability?.homeWinPercentage;
      seen.set(Number(e.id), {
        patch: {
          status,
          home_points: points(home),
          away_points: points(away),
          // Kept on a final, unlike football, so the card can say "Final / OT".
          current_period: c.status?.period ?? null,
          current_clock: inP ? (c.status?.displayClock ?? null) : null,
          last_play: inP ? (lp?.text ?? null) : null,
        },
        h: lineOf(home),
        a: lineOf(away),
        wp: inP && typeof wp === "number" && wp >= 0 && wp <= 1 ? wp : null,
        play: { text: inP ? (lp?.text ?? null) : null, type: inP ? (lp?.type?.text ?? null) : null },
        lastScorer:
          made && scorerId !== null
            ? scorerId === home.team?.id
              ? { side: "home", pts: scoreValue }
              : scorerId === away.team?.id
                ? { side: "away", pts: scoreValue }
                : null
            : null,
      });
    }
  };
  ingest(first.events);

  /* The rollover seam. ESPN's dateless board is "today" by ESPN's clock, and
     when it turns over is ESPN's business. If a game this database believes is
     live is not on that board, the board has moved on without it — and left
     alone, that game would sit at its last score forever, live on the slate
     with nobody polling it. So the two Eastern dates either side of now are
     asked for by name. Costs two extra calls on the rare tick it happens and
     none otherwise. */
  const { data: liveRows } = await db
    .from("games")
    .select("id")
    .eq("sport", "cbb")
    .eq("status", "in_progress");
  const stranded = (liveRows ?? []).filter((r: { id: number }) => !seen.has(r.id));
  if (stranded.length > 0) {
    const et = (ms: number) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .format(new Date(ms))
        .replaceAll("-", "");
    for (const d of [et(now - 24 * 3600_000), et(now)]) {
      const extra = await pull(d);
      if (!extra.ok) continue;
      // Never let a named board overwrite what the current one already said.
      ingest(extra.events.filter((e: any) => !seen.has(Number(e.id))));
    }
  }
  // 200: healthy. Our gate says a game is live or imminent and ESPN has not
  // put it on the board yet — normal in the minutes before tip.
  if (seen.size === 0) return new Response("no active espn games", { status: 200 });

  // One read of what's stored, so unchanged games cost zero writes. Chunked:
  // a Saturday is 150 ids and PostgREST's `in` is a URL.
  const ids = [...seen.keys()];
  const stored: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db
      .from("games")
      .select("id, status, home_points, away_points, current_period, current_clock, last_play, hoops")
      .in("id", ids.slice(i, i + 100))
      .eq("sport", "cbb");
    // Our own database refusing a read is a fault on this side, not upstream.
    if (error) return new Response(`read failed: ${error.message}`, { status: 500 });
    stored.push(...(data ?? []));
  }

  const lines: string[] = [];
  let updated = 0;
  for (const row of stored) {
    const s = seen.get(row.id)!;
    // A stored final is final: a stale ESPN "in" must not reopen a game whose
    // bets have already been graded.
    if (row.status === "final" && s.patch.status !== "final") continue;

    const prev: Hoops | null =
      row.hoops && Array.isArray(row.hoops.h) && Array.isArray(row.hoops.a) ? row.hoops : null;
    const inP = s.patch.status === "in_progress";
    const dh = (s.patch.home_points ?? 0) - (row.home_points ?? 0);
    const da = (s.patch.away_points ?? 0) - (row.away_points ?? 0);
    const hoops: Hoops = {
      h: s.h,
      a: s.a,
      // A run is a live fact; a final carries none.
      run: inP ? nextRun(prev?.run ?? null, dh, da, s.lastScorer) : null,
      wp: s.wp,
    };

    const p: Patch = { ...s.patch, hoops };
    // A timeout keeps whatever real play is already stored, so the diff below
    // sees no change and nothing fans out for a play that did not happen.
    if (inP && !isRealPlay(s.play.text, s.play.type)) p.last_play = row.last_play;

    const same =
      row.status === p.status &&
      row.home_points === p.home_points &&
      row.away_points === p.away_points &&
      row.current_period === p.current_period &&
      row.current_clock === p.current_clock &&
      row.last_play === p.last_play &&
      sameHoops(prev, hoops);
    if (same) continue;

    // LIVE-4: stamped after the diff decides, never as part of it, and only
    // when the play is genuinely new.
    const write: Patch & { last_play_at?: string } = { ...p };
    if (p.last_play && p.last_play !== row.last_play) {
      write.last_play_at = new Date().toISOString();
    }
    const { error } = await db.from("games").update(write).eq("id", row.id).eq("sport", "cbb");
    if (!error) {
      updated++;
      lines.push(
        `${row.id} ${p.status} ${p.away_points}-${p.home_points} P${p.current_period ?? "F"} ${p.current_clock ?? ""}`,
      );
    } else {
      lines.push(`${row.id} ERROR ${error.message}`);
    }
  }
  return new Response(`updated ${updated}/${stored.length}\n` + lines.join("\n"), { status: 200 });
});

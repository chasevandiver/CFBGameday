import type { SupabaseClient } from "@supabase/supabase-js";
import { activeSettings, fill, pushConfigured, sendToUser } from "../../src/lib/push";

/**
 * The scheduled half of push (docs/STATUS.md PUSH-3, PUSH-4).
 *
 * Kept out of jobs-core.ts on purpose: a push failure must never be able to
 * fail the job that detected the event. Every entry point here swallows its own
 * errors and reports them in the return value, so the scoreboard keeps polling
 * and the freeze keeps freezing whatever the push service is doing.
 */

type Json = Record<string, unknown>;

/**
 * One nudge before the week's first kickoff, to members of a group who still
 * have picks open.
 *
 * The lead time is `notification_settings.lead_minutes`, editable from /admin.
 * Actions cron lags 5–30 minutes, so this is scheduled to run well before the
 * window and fires for any group whose first kickoff falls inside it — a late
 * run still notifies, a little later than intended, rather than not at all.
 */
export async function notifyPicksDueJob(db: SupabaseClient): Promise<Json> {
  if (!pushConfigured()) return { skipped: "no vapid keys" };
  const settings = await activeSettings(db, "picks_due");
  if (!settings) return { skipped: "disabled in notification_settings" };

  const now = Date.now();
  const windowEnd = new Date(now + settings.lead_minutes * 60_000).toISOString();
  const nowIso = new Date(now).toISOString();

  // Every group-week whose earliest un-started game kicks off inside the window.
  const { data: rows, error } = await db
    .from("group_week_games")
    .select("group_id, season_id, week, games!inner(id, start_ts)")
    .gte("games.start_ts", nowIso)
    .lte("games.start_ts", windowEnd);
  if (error) return { error: error.message };

  type Row = {
    group_id: string;
    season_id: number;
    week: number;
    games: { id: number; start_ts: string };
  };

  // Collapse to one entry per group-week, holding its earliest kickoff.
  const weeks = new Map<string, { group_id: string; season_id: number; week: number; kickoff: string }>();
  for (const row of (rows ?? []) as unknown as Row[]) {
    const key = `${row.group_id}:${row.season_id}:${row.week}`;
    const current = weeks.get(key);
    if (!current || row.games.start_ts < current.kickoff) {
      weeks.set(key, {
        group_id: row.group_id,
        season_id: row.season_id,
        week: row.week,
        kickoff: row.games.start_ts,
      });
    }
  }

  let notified = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const [, wk] of weeks) {
    const [{ data: group }, { data: members }, { data: games }] = await Promise.all([
      db.from("groups").select("name, slug").eq("id", wk.group_id).maybeSingle(),
      db.from("group_members").select("user_id").eq("group_id", wk.group_id),
      db
        .from("group_week_games")
        .select("game_id")
        .eq("group_id", wk.group_id)
        .eq("season_id", wk.season_id)
        .eq("week", wk.week),
    ]);

    const gameIds = (games ?? []).map((g: { game_id: number }) => g.game_id);
    if (gameIds.length === 0) continue;

    const kickoff = new Date(wk.kickoff).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });

    for (const member of (members ?? []) as { user_id: string }[]) {
      const { count } = await db
        .from("picks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", member.user_id)
        .in("game_id", gameIds);
      const open = gameIds.length - (count ?? 0);
      if (open <= 0) {
        skipped++;
        continue;
      }

      try {
        // One notification per person per group-week, forever — the subject is
        // the dedupe key, so a second run inside the window is a no-op.
        const result = await sendToUser(
          db,
          member.user_id,
          "picks_due",
          `picks:${wk.group_id}:${wk.season_id}:${wk.week}`,
          {
            title: fill(settings.title, { group: group?.name ?? "your group", count: open }),
            body: fill(settings.body, {
              count: open,
              group: group?.name ?? "your group",
              kickoff,
            }),
            url: group?.slug ? `/groups/${group.slug}/picks` : "/slate",
          },
        );
        if (result.sent > 0) notified++;
        else skipped++;
      } catch (err) {
        problems.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  return {
    group_weeks: weeks.size,
    notified,
    skipped,
    ...(problems.length ? { problems: problems.slice(0, 5) } : {}),
  };
}

/**
 * A wave's stable identity: its date and UTC hour. Two runs looking at the same
 * kickoff wave agree on this even when they disagree about which of its games
 * has yet to start.
 */
function waveKey(kickoff: string): string {
  const d = new Date(kickoff);
  return `${d.toISOString().slice(0, 10)}:${d.getUTCHours()}`;
}

/**
 * "Log your bets", to betting groups shortly before a Saturday kickoff wave.
 *
 * Betting groups only — `groups.kind = 'betting'`, the same flag
 * `group_is_betting` reads. A pick'em group has nothing to log.
 *
 * Games that have already kicked off are excluded, which is also the failure
 * mode: if Actions lags past the wave this sends nothing rather than telling
 * someone to log a bet on a game already playing. A late reminder here is worse
 * than none, so missing is the right way to fail.
 */
export async function notifyLogBetsJob(db: SupabaseClient): Promise<Json> {
  if (!pushConfigured()) return { skipped: "no vapid keys" };
  const settings = await activeSettings(db, "log_bets");
  if (!settings) return { skipped: "disabled in notification_settings" };

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const windowEnd = new Date(now + settings.lead_minutes * 60_000).toISOString();

  const { data: rows, error } = await db
    .from("group_week_games")
    .select("group_id, season_id, week, games!inner(start_ts), groups!inner(name, slug, kind)")
    .eq("groups.kind", "betting")
    .gte("games.start_ts", nowIso)
    .lte("games.start_ts", windowEnd);
  if (error) return { error: error.message };

  type Row = {
    group_id: string;
    season_id: number;
    week: number;
    games: { start_ts: string };
    groups: { name: string; slug: string };
  };

  // ONE notification per group per wave — never one per game. The body names
  // the group and the time and says nothing about which games are unlogged,
  // because this is a reminder to open the sheet, not a checklist.
  const waves = new Map<
    string,
    { group_id: string; name: string; slug: string; season_id: number; week: number; kickoff: string }
  >();
  for (const row of (rows ?? []) as unknown as Row[]) {
    const key = `${row.group_id}:${row.season_id}:${row.week}`;
    const current = waves.get(key);
    if (!current || row.games.start_ts < current.kickoff) {
      waves.set(key, {
        group_id: row.group_id,
        name: row.groups.name,
        slug: row.groups.slug,
        season_id: row.season_id,
        week: row.week,
        kickoff: row.games.start_ts,
      });
    }
  }

  let notified = 0;
  const problems: string[] = [];

  for (const [, wave] of waves) {
    const { data: members } = await db
      .from("group_members")
      .select("user_id")
      .eq("group_id", wave.group_id);

    const kickoff = new Date(wave.kickoff).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "2-digit",
    });

    for (const member of (members ?? []) as { user_id: string }[]) {
      try {
        const result = await sendToUser(
          db,
          member.user_id,
          "log_bets",
          // Keyed on the wave, not on the earliest kickoff still in the
          // window. Those differ: a run that lags past the first game filters
          // it out as already-started, the "earliest" becomes the next game,
          // and a kickoff-keyed subject would let a second notification
          // through for the wave it already covered. The UTC hour is stable
          // across every run that can see the same wave.
          `bets:${wave.group_id}:${waveKey(wave.kickoff)}`,
          {
            title: fill(settings.title, { group: wave.name, kickoff }),
            body: fill(settings.body, { group: wave.name, kickoff }),
            url: `/groups/${wave.slug}`,
          },
        );
        if (result.sent > 0) notified++;
      } catch (err) {
        problems.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  return { waves: waves.size, notified, ...(problems.length ? { problems: problems.slice(0, 5) } : {}) };
}

/** A cover flip, as the scoreboard job has just written it. */
export interface FlipNotice {
  game_id: number;
  market: "spread" | "total";
  to_side: string;
  home_points: number;
  away_points: number;
  period: number | null;
  clock: string | null;
}

/**
 * Tell the people holding the side that just moved.
 *
 * Called from inside the scoreboard job, immediately after a flip is written to
 * `cover_flips` — the transition is only observable live, which is why the
 * detector already runs there. This never throws: the caller is a polling loop
 * that must not die because a push service had a bad minute.
 */
export async function notifyBadBeats(
  db: SupabaseClient,
  flips: FlipNotice[],
): Promise<{ notified: number; errors: number }> {
  if (flips.length === 0 || !pushConfigured()) return { notified: 0, errors: 0 };

  let notified = 0;
  let errors = 0;
  try {
    const settings = await activeSettings(db, "bad_beat");
    if (!settings) return { notified: 0, errors: 0 };

    for (const flip of flips) {
      const { data: game } = await db
        .from("games")
        .select("home_team_id, away_team_id, teams_home:home_team_id(school), teams_away:away_team_id(school)")
        .eq("id", flip.game_id)
        .maybeSingle();

      // Who is now on the wrong end of it. For a spread the losing side is the
      // one the result moved AWAY from; for a total it is over/under flipping.
      const hurt =
        flip.market === "spread"
          ? flip.to_side === "home"
            ? "away"
            : "home"
          : flip.to_side === "over"
            ? "under"
            : "over";

      const { data: picks } = await db
        .from("picks")
        .select("user_id, side")
        .eq("game_id", flip.game_id)
        .eq("side", hurt);

      const home = (game as { teams_home?: { school?: string } } | null)?.teams_home?.school ?? "Home";
      const away = (game as { teams_away?: { school?: string } } | null)?.teams_away?.school ?? "Away";
      const clock = flip.clock ? `${flip.clock} left in Q${flip.period ?? "?"}` : "late";

      for (const pick of (picks ?? []) as { user_id: string }[]) {
        try {
          const result = await sendToUser(
            db,
            pick.user_id,
            "bad_beat",
            // One per flip per person: a flip that flips back writes a second
            // cover_flips row with its own id, and this keys on the game and
            // the side, so the second one is a fresh notification.
            `game:${flip.game_id}:${flip.market}:${flip.to_side}`,
            {
              title: fill(settings.title, { team: flip.to_side === "home" ? home : away }),
              body: fill(settings.body, {
                detail: `${away} ${flip.away_points}, ${home} ${flip.home_points} — ${clock}.`,
                home,
                away,
              }),
              url: `/game/${flip.game_id}`,
            },
          );
          if (result.sent > 0) notified++;
        } catch {
          errors++;
        }
      }
    }
  } catch {
    errors++;
  }
  return { notified, errors };
}

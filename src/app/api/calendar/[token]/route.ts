import { NextResponse, type NextRequest } from "next/server";
import { buildCalendar, type IcsEvent } from "../../../../lib/ics";
import { watchLabel } from "../../../../lib/watch-on";
import { createServiceClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * The subscribe-once calendar feed (R2-A3).
 *
 * Calendar clients cannot sign in, so the token in the URL is the credential
 * (migration 0054) and the reads run on the service client — the same posture
 * as api/push/resubscribe. Everything this feed can ever disclose is one
 * user's schedule: their favorites' kickoffs and their groups' deadlines.
 * Unknown token → uniform 404, indistinguishable from a wrong path.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_DAYS = 45;

interface FeedGame {
  id: number;
  home_team_id: number;
  away_team_id: number;
  start_ts: string;
  tv: string | null;
  season_id: number;
  week: number;
  season_type: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!UUID_RE.test(token)) return new NextResponse("Not found", { status: 404 });

  const db = createServiceClient();
  const { data: tok } = await db
    .from("calendar_tokens")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();
  if (!tok) return new NextResponse("Not found", { status: 404 });
  const userId = tok.user_id as string;

  const now = new Date();
  const horizon = new Date(now.getTime() + WINDOW_DAYS * 24 * 3600 * 1000);
  const events: IcsEvent[] = [];

  // ---- favorites' games, both leagues ----
  const { data: profile } = await db
    .from("profiles")
    .select("favorite_team_ids")
    .eq("id", userId)
    .maybeSingle();
  const favIds = (profile?.favorite_team_ids ?? []) as number[];
  if (favIds.length > 0) {
    const idList = favIds.join(",");
    const { data: games } = await db
      .from("games")
      .select("id, home_team_id, away_team_id, start_ts, tv, season_id, week, season_type")
      .or(`home_team_id.in.(${idList}),away_team_id.in.(${idList})`)
      .gte("start_ts", now.toISOString())
      .lte("start_ts", horizon.toISOString())
      .order("start_ts", { ascending: true });
    const favGames = (games ?? []) as FeedGame[];
    const teamIds = [...new Set(favGames.flatMap((g) => [g.home_team_id, g.away_team_id]))];
    const { data: teams } = teamIds.length
      ? await db.from("teams").select("id, school, abbreviation").in("id", teamIds)
      : { data: [] };
    const nameOf = new Map(
      ((teams ?? []) as Array<{ id: number; school: string; abbreviation: string | null }>).map(
        (t) => [t.id, t.abbreviation ?? t.school],
      ),
    );
    for (const g of favGames) {
      const away = nameOf.get(g.away_team_id) ?? "?";
      const home = nameOf.get(g.home_team_id) ?? "?";
      const tv = watchLabel(g.tv);
      events.push({
        uid: `slate-game-${g.id}`,
        start: g.start_ts,
        summary: `${away} @ ${home}${g.tv ? ` (${g.tv})` : ""}`,
        description: tv ?? undefined,
      });
    }
  }

  // ---- pick deadlines: earliest kickoff of each configured future week ----
  const { data: memberships } = await db
    .from("group_members")
    .select("group_id, groups(id, name, kind)")
    .eq("user_id", userId);
  const groups = ((memberships ?? []) as unknown as Array<{
    group_id: string;
    groups: { id: string; name: string; kind: string } | null;
  }>)
    .map((m) => m.groups)
    .filter((g): g is { id: string; name: string; kind: string } => g !== null);

  const pickemIds = groups.filter((g) => g.kind === "pickem").map((g) => g.id);
  if (pickemIds.length > 0) {
    const { data: configs } = await db
      .from("group_week_config")
      .select("group_id, season_id, week, season_type")
      .in("group_id", pickemIds);
    const cfgs = (configs ?? []) as Array<{
      group_id: string;
      season_id: number;
      week: number;
      season_type: string;
    }>;
    const combos = [...new Set(cfgs.map((c) => `${c.season_id}:${c.week}:${c.season_type}`))];
    const earliest = new Map<string, string>();
    for (const seasonId of [...new Set(cfgs.map((c) => c.season_id))]) {
      const { data: weekGames } = await db
        .from("games")
        .select("week, season_type, start_ts")
        .eq("season_id", seasonId)
        .gte("start_ts", now.toISOString())
        .lte("start_ts", horizon.toISOString());
      for (const g of (weekGames ?? []) as Array<{
        week: number;
        season_type: string;
        start_ts: string;
      }>) {
        const key = `${seasonId}:${g.week}:${g.season_type}`;
        if (!combos.includes(key)) continue;
        const cur = earliest.get(key);
        if (!cur || g.start_ts < cur) earliest.set(key, g.start_ts);
      }
    }
    const nameById = new Map(groups.map((g) => [g.id, g.name]));
    for (const c of cfgs) {
      const kick = earliest.get(`${c.season_id}:${c.week}:${c.season_type}`);
      if (!kick) continue;
      events.push({
        uid: `slate-deadline-${c.group_id}-${c.season_id}-${c.season_type}-${c.week}`,
        start: kick,
        end: kick,
        summary: `Picks due — ${nameById.get(c.group_id) ?? "group"} (week ${c.week})`,
        description: "Picks lock at each game’s kickoff; this is the week’s first.",
      });
    }
  }

  // ---- survivor deadlines: first kickoff of each remaining week in scope ----
  const survivorIds = groups.filter((g) => g.kind === "survivor").map((g) => g.id);
  if (survivorIds.length > 0) {
    const { data: pools } = await db
      .from("survivor_pools")
      .select("group_id, season_id, start_week")
      .in("group_id", survivorIds);
    const nameById = new Map(groups.map((g) => [g.id, g.name]));
    for (const p of (pools ?? []) as Array<{
      group_id: string;
      season_id: number;
      start_week: number;
    }>) {
      const { data: weekGames } = await db
        .from("games")
        .select("week, start_ts")
        .eq("season_id", p.season_id)
        .eq("season_type", "regular")
        .gte("week", p.start_week)
        .gte("start_ts", now.toISOString())
        .lte("start_ts", horizon.toISOString());
      const earliest = new Map<number, string>();
      for (const g of (weekGames ?? []) as Array<{ week: number; start_ts: string }>) {
        const cur = earliest.get(g.week);
        if (!cur || g.start_ts < cur) earliest.set(g.week, g.start_ts);
      }
      for (const [week, kick] of earliest) {
        events.push({
          uid: `slate-survivor-${p.group_id}-${p.season_id}-${week}`,
          start: kick,
          end: kick,
          summary: `Survivor pick due — ${nameById.get(p.group_id) ?? "pool"} (week ${week})`,
          description: "Your pick locks at its game’s kickoff; this is the week’s first.",
        });
      }
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  const body = buildCalendar("The Slate", events, now.toISOString());
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=900",
    },
  });
}

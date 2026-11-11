import { NextResponse, type NextRequest } from "next/server";

/* TEMPORARY probe (removed before merge): shows the shape of ESPN's league
   feed so the real route can be written against it. */
const LEAGUE = 1129229;

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("probe") === "players") {
    const base = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026";
    const lg = await (await fetch(`${base}/segments/0/leagues/${LEAGUE}?view=mMatchupScore&view=mScoreboard&view=mStatus`, { cache: "no-store" })).json();
    const cur = lg.status.currentMatchupPeriod;
    const m = lg.schedule.find((x: { matchupPeriodId: number; home: { teamId: number }; away?: { teamId: number } }) => x.matchupPeriodId === cur && (x.home.teamId === 1 || x.away?.teamId === 1));
    const side = m.home.teamId === 1 ? m.home : m.away;
    const entries = side.rosterForCurrentScoringPeriod.entries.map((e: { lineupSlotId: number; playerPoolEntry: { appliedStatTotal: number; player: Record<string, unknown> } }) => ({
      slot: e.lineupSlotId,
      pts: e.playerPoolEntry.appliedStatTotal,
      name: e.playerPoolEntry.player.fullName,
      pro: e.playerPoolEntry.player.proTeamId,
      pos: e.playerPoolEntry.player.defaultPositionId,
      keys: Object.keys(e.playerPoolEntry.player),
    }));
    const pro = await (await fetch(`${base}?view=proTeamSchedules_wl`, { cache: "no-store" })).json();
    const teams = (pro.settings?.proTeams ?? []).map((t: { id: number; abbrev: string; byeWeek: number; proGamesByScoringPeriod?: Record<string, unknown[]> }) => ({
      id: t.id,
      abbrev: t.abbrev,
      bye: t.byeWeek,
      p10: t.proGamesByScoringPeriod?.[String(cur)],
    }));
    return NextResponse.json({ cur, matchupId: m.id, entries, proTeams: teams.slice(0, 34) });
  }
  const season = req.nextUrl.searchParams.get("season") ?? "2026";
  const views = req.nextUrl.searchParams.getAll("view");
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${LEAGUE}?` +
    (views.length ? views : ["mTeam", "mMatchupScore", "mScoreboard", "mStatus"])
      .map((v) => `view=${v}`)
      .join("&");
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ status: res.status, text: text.slice(0, 2000) });
  }
  const j = json as Record<string, unknown>;
  const schedule = (j.schedule as Array<Record<string, unknown>> | undefined) ?? [];
  const status = j.status as Record<string, unknown> | undefined;
  const cur = status?.currentMatchupPeriod;
  const current = schedule.filter((m) => m.matchupPeriodId === cur);
  const trim = (o: unknown, depth: number): unknown => {
    if (depth <= 0) return Array.isArray(o) ? `[array ${o.length}]` : typeof o === "object" && o ? "{…}" : o;
    if (Array.isArray(o)) return o.slice(0, 2).map((x) => trim(x, depth - 1));
    if (typeof o === "object" && o) {
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, trim(v, depth - 1)]));
    }
    return o;
  };
  return NextResponse.json({
    status: res.status,
    topKeys: Object.keys(j),
    scoringPeriodId: j.scoringPeriodId,
    statusObj: trim(status, 2),
    teams: ((j.teams as Array<Record<string, unknown>>) ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      location: t.location,
      nickname: t.nickname,
      abbrev: t.abbrev,
      logo: t.logo,
      record: trim(t.record, 3),
    })),
    scheduleCount: schedule.length,
    currentCount: current.length,
    currentSample: trim(current[0], 6),
  });
}

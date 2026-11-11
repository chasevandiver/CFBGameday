import { NextResponse, type NextRequest } from "next/server";

/* TEMPORARY probe (removed before merge): shows the shape of ESPN's league
   feed so the real route can be written against it. */
const LEAGUE = 1129229;

export async function GET(req: NextRequest) {
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

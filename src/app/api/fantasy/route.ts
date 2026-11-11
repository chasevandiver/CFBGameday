import { NextResponse, type NextRequest } from "next/server";
import { toFantasy, type EspnLeague, type EspnProSchedules } from "../../../lib/fantasy";

/**
 * GET /api/fantasy?league=<ESPN league id>&team=<ESPN team id> (TV-12)
 *
 * The viewer's ESPN fantasy matchup plus the rest of the league's, for the TV
 * cards. Public ESPN leagues only: no cookies are stored or forwarded. ESPN's
 * feed is unofficial; a failure is a 502 the cards simply skip.
 */
const BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";
const ID = /^\d{1,12}$/;

export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get("league") ?? "";
  const team = req.nextUrl.searchParams.get("team");
  if (!ID.test(league) || (team !== null && !ID.test(team))) {
    return NextResponse.json({ error: "league and team must be ESPN ids" }, { status: 400 });
  }
  // The NFL season is named for the year it starts; Jan-Feb belong to the last.
  const now = new Date();
  const season = now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();

  try {
    const [lg, pro] = await Promise.all([
      fetch(
        `${BASE}/${season}/segments/0/leagues/${league}?view=mTeam&view=mMatchupScore&view=mScoreboard&view=mStatus`,
        { cache: "no-store" },
      ),
      // Kickoff times barely change; six hours of cache is plenty.
      fetch(`${BASE}/${season}?view=proTeamSchedules_wl`, { next: { revalidate: 21_600 } }),
    ]);
    if (!lg.ok) {
      return NextResponse.json(
        { error: lg.status === 401 ? "league is private" : `ESPN ${lg.status}` },
        { status: 502 },
      );
    }
    const data = toFantasy(
      (await lg.json()) as EspnLeague,
      pro.ok ? ((await pro.json()) as EspnProSchedules) : null,
      team === null ? null : Number(team),
      Date.now(),
    );
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "ESPN unreachable" }, { status: 502 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import {
  DC_GROUPS,
  DC_MISTAKES,
  dcJudge,
  dcOver,
  dcPayload,
  type DcEntryState,
} from "../../../lib/depth-chart";
import { fetchDcDay, fetchDcEntry, fetchDcStanding } from "../../../lib/depth-chart-data";
import { productDate } from "../../../lib/streak";
import { createClient } from "../../../lib/supabase/server";
import { createServiceClient } from "../../../lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Depth Chart's play surface (DC-2).
 *
 * This is the one game of the three with a real hidden answer, so the route is
 * doing real work: `dc_puzzle_groups` has RLS on and no select policy, and the
 * payload reveals a group only once the player has solved it or run out of
 * mistakes. The tiles themselves are public and readable from the page —
 * sixteen school names narrow nothing, and the board has to render before the
 * first guess.
 *
 * Judging happens here for the same reason it does on The Tape: the answer key
 * is not readable by the caller, so the client could not check a guess even if
 * it wanted to.
 */

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { user, service: createServiceClient() };
}

async function statsFor(service: ReturnType<typeof createServiceClient>, userId: string) {
  const s = await fetchDcStanding(service, userId);
  return { streak: s.streak, bestStreak: s.bestStreak, played: s.played, won: s.won };
}

export async function GET() {
  const day = productDate(new Date());
  const ctx = await session();
  if (!ctx) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const [today, entry, stats] = await Promise.all([
    fetchDcDay(ctx.service, day),
    fetchDcEntry(ctx.service, ctx.user.id, day),
    statsFor(ctx.service, ctx.user.id),
  ]);
  if (!today) return NextResponse.json({ error: "No board today" }, { status: 404 });

  return NextResponse.json(dcPayload(day, today.grid, entry, stats));
}

export async function POST(req: NextRequest) {
  const day = productDate(new Date());
  const ctx = await session();
  if (!ctx) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  let teamIds: number[];
  try {
    const body = (await req.json()) as { teamIds?: unknown };
    teamIds = Array.isArray(body.teamIds) ? body.teamIds.map(Number) : [];
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (teamIds.length !== 4 || teamIds.some((n) => !Number.isInteger(n))) {
    return NextResponse.json({ error: "Pick four" }, { status: 400 });
  }
  if (new Set(teamIds).size !== 4) {
    return NextResponse.json({ error: "Pick four different teams" }, { status: 400 });
  }

  const [today, entry] = await Promise.all([
    fetchDcDay(ctx.service, day),
    fetchDcEntry(ctx.service, ctx.user.id, day),
  ]);
  if (!today) return NextResponse.json({ error: "No board today" }, { status: 404 });
  if (dcOver(entry)) {
    return NextResponse.json({ error: "Today's board is finished" }, { status: 409 });
  }

  /* Every tile must still be in play. Without this a client could submit a
     group it has already solved and farm the board, and a tile that is not on
     the board at all would judge as a plain miss rather than as the bad request
     it is. */
  const solved = new Set(entry.solved);
  const gone = new Set(
    today.grid.groups.filter((g) => solved.has(g.id)).flatMap((g) => g.teamIds),
  );
  const onBoard = new Set(today.grid.tiles.filter((t) => !gone.has(t)));
  if (teamIds.some((t) => !onBoard.has(t))) {
    return NextResponse.json({ error: "Those are not all in play" }, { status: 422 });
  }

  const { verdict, groupId } = dcJudge(teamIds, today.grid.groups);
  const next: DcEntryState = {
    solved: verdict === "correct" && groupId ? [...entry.solved, groupId] : entry.solved,
    /* "One away" costs a mistake, exactly like a miss. It is a kinder MESSAGE,
       not a free guess — a near miss you can spend forever on is not a puzzle. */
    mistakes: verdict === "correct" ? entry.mistakes : entry.mistakes + 1,
    guesses: [...entry.guesses, { teamIds, verdict }],
    completed_at: null,
  };
  const over = next.solved.length >= DC_GROUPS || next.mistakes >= DC_MISTAKES;
  next.completed_at = over ? new Date().toISOString() : null;

  const { error } = await ctx.service.from("dc_entries").upsert(
    {
      user_id: ctx.user.id,
      day,
      solved: next.solved,
      mistakes: next.mistakes,
      guesses: next.guesses,
      completed_at: next.completed_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,day" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ...dcPayload(day, today.grid, next, await statsFor(ctx.service, ctx.user.id)),
    /* The verdict for THIS submission, so the board can say "one away" rather
       than leaving the player to infer it from the mistake counter. */
    lastVerdict: verdict,
  });
}

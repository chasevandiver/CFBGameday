import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Live columns for one game — the game page's poll fallback when realtime
 * misses an event. Public read (RLS: games is world-readable).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("games")
    .select(
      "id, status, home_points, away_points, current_period, current_clock, current_situation, last_play, possession",
    )
    .eq("id", gameId)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}

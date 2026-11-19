import { NextResponse, type NextRequest } from "next/server";
import { openDoor } from "../../../../lib/jarvis-door";
import { fetchDoorContext } from "../../../../lib/jarvis-door-data";

export const dynamic = "force-dynamic";

/**
 * What Jarvis reads before it logs anything (JARVIS-1): the owner, the people
 * the owner may log a bet for, and the bet form's window of games with their
 * teams named. Nothing here is a secret the site does not already show a
 * signed-in owner — it is the bet form's two dropdowns as JSON — but it sits
 * behind the door all the same, because the people list is a roster.
 */
export async function GET(req: NextRequest) {
  const door = await openDoor(req.headers.get("authorization"));
  if (!door.ok) return NextResponse.json({ ok: false, error: door.error }, { status: door.status });
  return NextResponse.json({ ok: true, ...(await fetchDoorContext(door.supabase, door.ownerId)) });
}

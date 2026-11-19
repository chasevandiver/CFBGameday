import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { resolveBettor } from "../../../../../lib/bet-write";
import { doorVoidSchema, firstIssue, openDoor } from "../../../../../lib/jarvis-door";

export const dynamic = "force-dynamic";

/**
 * Void a bet through the Jarvis door (JARVIS-1) — `voidBet` for a caller with
 * no screen. Jarvis logs straight from a voice note and tells the owner what
 * it wrote; this is the button on that message.
 *
 * Who may ask is the "void own bets" policy (0083) and which columns may move
 * is `enforce_bet_void_only` (0013, 0045), exactly as from the ledger. The
 * one thing added is an honest answer: the action cannot tell "voided" from
 * "no such bet" and does not need to, because a person is looking at the row.
 * Here nobody is, so no row touched is a 404 rather than a silent success.
 */
export async function POST(req: NextRequest) {
  const door = await openDoor(req.headers.get("authorization"));
  if (!door.ok) return NextResponse.json({ ok: false, error: door.error }, { status: door.status });
  const { supabase, ownerId } = door;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }
  const parsed = doorVoidSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: firstIssue(parsed.error) }, { status: 400 });
  }

  const bettor = await resolveBettor(supabase, ownerId, parsed.data.for_user ?? null);
  if ("refused" in bettor) {
    return NextResponse.json({ ok: false, error: bettor.refused }, { status: 403 });
  }

  const { data: touched, error } = await supabase
    .from("bets")
    .update({ voided_at: new Date().toISOString(), result: "void" })
    .eq("id", parsed.data.id)
    .eq("user_id", bettor.userId)
    .select("id");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  if (((touched ?? []) as unknown[]).length === 0) {
    return NextResponse.json({ ok: false, error: "No such bet" }, { status: 404 });
  }

  // The same four `voidBet` clears: the ledger, the group sheet, the slate
  // cards and the game page all show logged bets.
  revalidatePath("/ledger");
  revalidatePath("/groups", "layout");
  revalidatePath("/slate");
  revalidatePath("/game", "layout");
  return NextResponse.json({ ok: true });
}

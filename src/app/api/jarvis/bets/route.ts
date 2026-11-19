import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { resolveBettor, storedLine } from "../../../../lib/bet-write";
import { doorBetSchema, firstIssue, openDoor } from "../../../../lib/jarvis-door";

export const dynamic = "force-dynamic";

/**
 * Log one bet through the Jarvis door (JARVIS-1). `lib/jarvis-door.ts` says
 * what the door is; this is `logBet` for a caller with no form.
 *
 * Same row, same order of questions: the game must exist, the bettor must be
 * the owner or someone the grant says the owner may log for, and only then is
 * anything written. Two differences from the form, both because nobody is
 * looking at a screen when this runs:
 *
 * - **A repeat is refused** (409, `duplicate: true`). A voice note that is
 *   processed twice must not put two units on a friend's record, so a bettor
 *   already holding the same side of the same market on the same game gets
 *   no second row — `copyBet`'s rule, for `copyBet`'s reason.
 * - **The new row's id comes back**, because void is the ledger's only edit
 *   and Jarvis has to be able to offer it.
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
  const parsed = doorBetSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: firstIssue(parsed.error) }, { status: 400 });
  }
  const bet = parsed.data;

  // A bet belongs to its game's season (an NFL bet under the CFB pointer is
  // one the NFL grader never sees — the same lookup `logBet` makes).
  const { data: game } = await supabase
    .from("games")
    .select("id, season_id")
    .eq("id", bet.game_id)
    .maybeSingle();
  if (!game) return NextResponse.json({ ok: false, error: "Bad game" }, { status: 404 });

  const bettor = await resolveBettor(supabase, ownerId, bet.for_user ?? null);
  if ("refused" in bettor) {
    return NextResponse.json({ ok: false, error: bettor.refused }, { status: 403 });
  }

  const { data: held } = await supabase
    .from("bets")
    .select("bet_type, side, voided_at")
    .eq("game_id", bet.game_id)
    .eq("user_id", bettor.userId);
  const already = (
    (held ?? []) as Array<{ bet_type: string; side: string | null; voided_at?: string | null }>
  ).some((h) => !h.voided_at && h.bet_type === bet.bet_type && h.side === bet.side);
  if (already) {
    return NextResponse.json(
      { ok: false, duplicate: true, error: "Already on their ledger" },
      { status: 409 },
    );
  }

  const { data: written, error } = await supabase
    .from("bets")
    .insert({
      season_id: (game as { season_id: number }).season_id,
      user_id: bettor.userId,
      logged_by: bettor.loggedBy,
      game_id: bet.game_id,
      bet_type: bet.bet_type,
      description: bet.description,
      side: bet.side,
      team_side: null,
      line_taken: storedLine(bet.bet_type, bet.side, bet.line ?? null),
      odds: bet.odds ?? -110,
      units: bet.units ?? 1,
      book: null,
      confidence: "bet",
    })
    .select("id");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  revalidatePath("/ledger");
  if (bettor.loggedBy !== null) revalidatePath("/groups", "layout");
  const id = ((written ?? []) as Array<{ id?: number }>)[0]?.id ?? null;
  return NextResponse.json({ ok: true, id });
}

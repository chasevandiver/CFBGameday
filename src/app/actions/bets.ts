"use server";

import { revalidatePath } from "next/cache";
import { REASON_TAGS } from "../../lib/db-types";
import { homeLineForSide } from "../../lib/slate";
import { createClient } from "../../lib/supabase/server";

/**
 * Bet forms and the slip speak in the bettor's number ("UNC +6.5"); the
 * `bets` table stores spread-style lines home-perspective (−6.5), which is
 * what the grader (`jobs-core`), `liveSpreadStatus` and `spreadClv` all read.
 * Totals are side-agnostic and pass through.
 */
const SPREAD_STYLE = new Set(["spread", "first_half"]);
function storedLine(betType: string, side: string | null, line: number | null): number | null {
  if (line === null || side === null || !SPREAD_STYLE.has(betType)) return line;
  return homeLineForSide(side, line);
}

export interface BetActionResult {
  ok: boolean;
  message?: string;
}

export async function logBet(formData: FormData): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to log bets" };

  const description = String(formData.get("description") ?? "").trim();
  const betType = String(formData.get("bet_type") ?? "spread");
  const reasonTag = String(formData.get("reason_tag") ?? "");
  const units = Number(formData.get("units"));
  const odds = Number(formData.get("odds") || -110);
  const lineRaw = String(formData.get("line_taken") ?? "").trim();
  const book = String(formData.get("book") ?? "").trim();
  const seasonId = Number(formData.get("season_id"));
  const gameIdRaw = String(formData.get("game_id") ?? "").trim();
  const sideRaw = String(formData.get("side") ?? "").trim();

  if (!description) return { ok: false, message: "Describe the bet (e.g. “Michigan -3.5”)" };
  if (!REASON_TAGS.includes(reasonTag as (typeof REASON_TAGS)[number])) {
    return { ok: false, message: "Pick a reason tag — that's the whole point of the audit" };
  }
  if (!Number.isFinite(units) || units <= 0) return { ok: false, message: "Units must be > 0" };

  let gameId: number | null = null;
  if (gameIdRaw !== "") {
    const parsed = Number(gameIdRaw);
    if (!Number.isInteger(parsed)) return { ok: false, message: "Bad game" };
    const { data: game } = await supabase.from("games").select("id").eq("id", parsed).maybeSingle();
    if (!game) return { ok: false, message: "Bad game" };
    gameId = parsed;
  }
  const side = ["home", "away", "over", "under"].includes(sideRaw) ? sideRaw : null;

  const { error } = await supabase.from("bets").insert({
    season_id: seasonId,
    user_id: user.id,
    game_id: gameId,
    bet_type: betType,
    description,
    side,
    line_taken: storedLine(betType, side, lineRaw === "" ? null : Number(lineRaw)),
    odds,
    units,
    book: book || null,
    reason_tag: reasonTag,
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  return { ok: true };
}

const SLIP_BET_TYPES = new Set(["spread", "total", "moneyline"]);
const SLIP_SIDES = new Set(["home", "away", "over", "under"]);

export interface SlipBetInput {
  gameId: number;
  betType: string;
  side: string;
  line: number | null;
  odds: number;
  units: number;
  description: string;
}

/** Log every selection on the bet slip in one shot (one ledger row each). */
export async function logSlipBets(
  seasonId: number,
  reasonTag: string,
  bets: SlipBetInput[],
): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to log bets" };

  if (!Number.isInteger(seasonId)) return { ok: false, message: "Bad season" };
  if (!REASON_TAGS.includes(reasonTag as (typeof REASON_TAGS)[number])) {
    return { ok: false, message: "Pick a reason tag — that's the whole point of the audit" };
  }
  if (bets.length === 0) return { ok: false, message: "Nothing on the slip" };
  if (bets.length > 25) return { ok: false, message: "Too many bets at once" };
  for (const b of bets) {
    if (!SLIP_BET_TYPES.has(b.betType) || !SLIP_SIDES.has(b.side))
      return { ok: false, message: "Bad selection" };
    if (!Number.isFinite(b.units) || b.units <= 0)
      return { ok: false, message: "Units must be > 0" };
    if (!Number.isFinite(b.odds)) return { ok: false, message: "Bad odds" };
    if (b.line !== null && !Number.isFinite(b.line)) return { ok: false, message: "Bad line" };
    if (!b.description.trim()) return { ok: false, message: "Bad selection" };
  }

  const gameIds = [...new Set(bets.map((b) => b.gameId))];
  const { data: games } = await supabase.from("games").select("id").in("id", gameIds);
  if ((games ?? []).length !== gameIds.length) return { ok: false, message: "Bad game" };

  const { error } = await supabase.from("bets").insert(
    bets.map((b) => ({
      season_id: seasonId,
      user_id: user.id,
      game_id: b.gameId,
      bet_type: b.betType,
      description: b.description.trim(),
      side: b.side,
      line_taken: storedLine(b.betType, b.side, b.line),
      odds: b.odds,
      units: b.units,
      reason_tag: reasonTag,
    })),
  );

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  revalidatePath("/slate");
  return { ok: true };
}

/** Append-only ledger: voiding is the only "delete" (docs/SPEC.md §5.3). */
export async function voidBet(betId: number): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  const { error } = await supabase
    .from("bets")
    .update({ voided_at: new Date().toISOString(), result: "void" })
    .eq("id", betId)
    .eq("user_id", user.id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  return { ok: true };
}

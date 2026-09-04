"use server";

import { revalidatePath } from "next/cache";
import { CONFIDENCE_TIERS, type ConfidenceTier } from "../../lib/db-types";
import { canLogBetFor } from "../../lib/log-for";
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

/**
 * Whose row this is (0083).
 *
 * Every write below is the signed-in user's own by default. A betting-group
 * admin may instead name a member of that group, and the row lands as that
 * member's bet with the admin's id in `logged_by`. The policy on `bets` would
 * refuse an unauthorised proxy row on its own; asking first turns a bare RLS
 * error into a sentence, and keeps the "who" decision in one place for the
 * three actions that need it.
 */
type Bettor = { userId: string; loggedBy: string | null };

async function resolveBettor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  callerId: string,
  forUserId: string | null,
): Promise<Bettor | { refused: string }> {
  if (!forUserId || forUserId === callerId) return { userId: callerId, loggedBy: null };
  if (!(await canLogBetFor(supabase, forUserId))) {
    return { refused: "You can only log bets for a member of a betting group you run" };
  }
  return { userId: forUserId, loggedBy: callerId };
}

/** The pages a proxy write shows up on, beyond the ledger the actions already refresh. */
function revalidateProxy(bettor: Bettor) {
  if (bettor.loggedBy !== null) revalidatePath("/groups", "layout");
}

export async function logBet(formData: FormData): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to log bets" };

  const description = String(formData.get("description") ?? "").trim();
  const betType = String(formData.get("bet_type") ?? "spread");
  const units = Number(formData.get("units"));
  const odds = Number(formData.get("odds") || -110);
  const lineRaw = String(formData.get("line_taken") ?? "").trim();
  const book = String(formData.get("book") ?? "").trim();
  const confidence = String(formData.get("confidence") ?? "bet");
  const seasonId = Number(formData.get("season_id"));
  const gameIdRaw = String(formData.get("game_id") ?? "").trim();
  const sideRaw = String(formData.get("side") ?? "").trim();
  const forRaw = String(formData.get("for_user") ?? "").trim();

  if (!description) return { ok: false, message: "Describe the bet (e.g. “Michigan -3.5”)" };
  if (!Number.isFinite(units) || units <= 0) return { ok: false, message: "Units must be > 0" };
  if (!CONFIDENCE_TIERS.includes(confidence as ConfidenceTier)) {
    return { ok: false, message: "Bad confidence tier" };
  }

  let gameId: number | null = null;
  // A bet attached to a game belongs to that game's season — the form's
  // season is the CFB pointer, and the games list spans both leagues now, so
  // an NFL bet must land under 102026 or the NFL grader never sees it.
  let gameSeasonId: number | null = null;
  if (gameIdRaw !== "") {
    const parsed = Number(gameIdRaw);
    if (!Number.isInteger(parsed)) return { ok: false, message: "Bad game" };
    const { data: game } = await supabase
      .from("games")
      .select("id, season_id")
      .eq("id", parsed)
      .maybeSingle();
    if (!game) return { ok: false, message: "Bad game" };
    gameId = parsed;
    gameSeasonId = game.season_id;
  }
  const side = ["home", "away", "over", "under"].includes(sideRaw) ? sideRaw : null;
  // Whose total a team_total settles on (R2-A4, 0055). Only meaningful for
  // that type; anything else stores null so the grader's skip-don't-guess
  // posture for legacy rows stays observable in the data.
  const teamSideRaw = String(formData.get("team_side") ?? "").trim();
  const teamSide =
    betType === "team_total" && ["home", "away"].includes(teamSideRaw) ? teamSideRaw : null;

  const bettor = await resolveBettor(supabase, user.id, forRaw || null);
  if ("refused" in bettor) return { ok: false, message: bettor.refused };

  const { error } = await supabase.from("bets").insert({
    season_id: gameSeasonId ?? seasonId,
    user_id: bettor.userId,
    logged_by: bettor.loggedBy,
    game_id: gameId,
    bet_type: betType,
    description,
    side,
    team_side: teamSide,
    line_taken: storedLine(betType, side, lineRaw === "" ? null : Number(lineRaw)),
    odds,
    units,
    book: book || null,
    confidence,
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  revalidateProxy(bettor);
  return { ok: true };
}

/**
 * Mark an open future to market (R2-A4). Manual by design — auto-marking was
 * rejected because no sanctioned feed carries futures odds (see 0055 and the
 * changelog entry). The 0055 trigger is the enforcement: only marked_odds
 * moves, only on an OPEN future, only the owner's own row (0018's policy).
 */
export async function markFuture(betId: number, odds: number | null): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first" };
  if (!Number.isInteger(betId)) return { ok: false, message: "Bad bet" };
  if (odds !== null && (!Number.isFinite(odds) || Math.abs(odds) < 100)) {
    return { ok: false, message: "American odds, e.g. +450 or -120" };
  }

  const { error } = await supabase
    .from("bets")
    .update({ marked_odds: odds })
    .eq("id", betId)
    .eq("user_id", user.id);
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
  confidence: string;
}

/**
 * Log every selection on the bet slip in one shot (one ledger row each).
 * `forUserId` (0083): a betting-group admin logging the slip as a member.
 */
export async function logSlipBets(
  seasonId: number,
  bets: SlipBetInput[],
  forUserId: string | null = null,
): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to log bets" };
  const bettor = await resolveBettor(supabase, user.id, forUserId);
  if ("refused" in bettor) return { ok: false, message: bettor.refused };

  if (!Number.isInteger(seasonId)) return { ok: false, message: "Bad season" };
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
    // The check constraint would catch this too, but a rejected insert here
    // would fail the whole slip on one bad tier rather than naming it.
    if (!CONFIDENCE_TIERS.includes(b.confidence as ConfidenceTier))
      return { ok: false, message: "Bad confidence tier" };
  }

  const gameIds = [...new Set(bets.map((b) => b.gameId))];
  const { data: games } = await supabase.from("games").select("id, season_id").in("id", gameIds);
  if ((games ?? []).length !== gameIds.length) return { ok: false, message: "Bad game" };
  // The slip's season is whatever slate it was opened on; each row still
  // stores its own game's season so cross-league grading always finds it.
  const seasonByGame = new Map((games ?? []).map((g) => [g.id, g.season_id as number]));

  const { error } = await supabase.from("bets").insert(
    bets.map((b) => ({
      season_id: seasonByGame.get(b.gameId) ?? seasonId,
      user_id: bettor.userId,
      logged_by: bettor.loggedBy,
      game_id: b.gameId,
      bet_type: b.betType,
      description: b.description.trim(),
      side: b.side,
      line_taken: storedLine(b.betType, b.side, b.line),
      odds: b.odds,
      units: b.units,
      confidence: b.confidence,
    })),
  );

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  revalidatePath("/slate");
  revalidateProxy(bettor);
  return { ok: true };
}

/**
 * Append-only ledger: voiding is the only "delete" (docs/SPEC.md §5.3).
 * `forUserId` (0083): an admin voiding a row they logged for a member — the
 * mistyped number from a text needs undoing by the person who typed it.
 */
export async function voidBet(
  betId: number,
  forUserId: string | null = null,
): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };
  if (!Number.isInteger(betId)) return { ok: false, message: "Bad bet" };
  const bettor = await resolveBettor(supabase, user.id, forUserId);
  if ("refused" in bettor) return { ok: false, message: bettor.refused };

  const { error } = await supabase
    .from("bets")
    .update({ voided_at: new Date().toISOString(), result: "void" })
    .eq("id", betId)
    .eq("user_id", bettor.userId);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  revalidateProxy(bettor);
  // The slate cards and the game page both show logged bets now, so a void has
  // to clear there too — otherwise the chip lingers until the next poll heals it.
  revalidatePath("/slate");
  revalidatePath("/game", "layout");
  return { ok: true };
}

/**
 * Move a bet's confidence tier before its game kicks off.
 *
 * The gate is migration 0045's trigger, not this function: it permits exactly
 * one more transition than 0013 did, and only while the game has not started.
 * So the error the user sees is the database's own ("kickoff — the confidence
 * tier is frozen for this bet"), which means the UI cannot drift out of step
 * with the rule.
 *
 * Freezing at kickoff is what keeps the tier worth storing — a tier that could
 * move afterwards would let anyone decide, once a game had gone well, that
 * they had called it their Bet of the Year all along.
 */
export async function retagBet(betId: number, confidence: string): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };
  if (!CONFIDENCE_TIERS.includes(confidence as ConfidenceTier)) {
    return { ok: false, message: "Bad confidence tier" };
  }

  const { error } = await supabase
    .from("bets")
    .update({ confidence })
    .eq("id", betId)
    .eq("user_id", user.id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  return { ok: true };
}

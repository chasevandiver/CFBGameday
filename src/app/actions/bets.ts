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
  /* LOGF-7: one entry can be several people's bet — "Hayden tailed Eric's
     Colts +3" is the same row on two ledgers. Each `for_user` becomes its own
     row; none at all is the caller, as it always was. */
  const forIds = [
    ...new Set(
      formData
        .getAll("for_user")
        .map((v) => String(v).trim())
        .filter((v) => v !== ""),
    ),
  ];
  if (forIds.length > 10) return { ok: false, message: "Too many people on one bet" };

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

  /* Every name is asked about before anything is written: one refusal stops
     the whole entry, so a bet never lands on two of three ledgers. */
  const bettors: Bettor[] = [];
  for (const id of forIds.length > 0 ? forIds : [null]) {
    const bettor = await resolveBettor(supabase, user.id, id);
    if ("refused" in bettor) return { ok: false, message: bettor.refused };
    bettors.push(bettor);
  }

  const { error } = await supabase.from("bets").insert(
    bettors.map((bettor) => ({
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
    })),
  );

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  for (const bettor of bettors) revalidateProxy(bettor);
  return { ok: true };
}

/**
 * Put an existing bet on somebody else's ledger too (LOGF-7).
 *
 * The week's "who bet what" page shows every member's bets; the most common
 * thing the admin does there is notice that Hayden tailed Eric's Colts +3 and
 * the tail never got logged. This copies the row — same game, market, side,
 * stored line, price and stake — onto each named ledger. The same grant as
 * `logBet` decides who may be named (yourself always; another member only for
 * an admin of their betting group), asked before anything is written.
 *
 * A copy is a new bet in every respect: stamped `now()` by the insert
 * sanitizer, so it lands after the source and reads as the tail it is; its
 * confidence the neutral rung, since conviction is the bettor's, not the
 * source's; graded by the same job. A target already holding the same side of
 * the same market on the same game is refused — the double tap on a phone is
 * far likelier than a deliberate second unit on an identical row, and the
 * form is still there for the rare real one.
 */
export async function copyBet(betId: number, forUserIds: string[]): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to log bets" };
  if (!Number.isInteger(betId)) return { ok: false, message: "Bad bet" };
  const targets = [...new Set(forUserIds)];
  if (targets.length === 0) return { ok: false, message: "Copy it to whom?" };
  if (targets.length > 10) return { ok: false, message: "Too many people at once" };

  const { data: src } = await supabase
    .from("bets")
    .select("*")
    .eq("id", betId)
    .maybeSingle();
  if (!src) return { ok: false, message: "Bad bet" };
  const source = src as {
    season_id: number;
    game_id: number | null;
    bet_type: string;
    description: string;
    side: string | null;
    team_side: string | null;
    line_taken: number | string | null;
    odds: number;
    units: number | string;
    voided_at: string | null;
  };
  if (source.voided_at) return { ok: false, message: "That bet was voided" };
  if (source.game_id === null) {
    return { ok: false, message: "Only a bet on a game can be copied — log a future by hand" };
  }

  const bettors: Bettor[] = [];
  for (const id of targets) {
    const bettor = await resolveBettor(supabase, user.id, id);
    if ("refused" in bettor) return { ok: false, message: bettor.refused };
    bettors.push(bettor);
  }

  const { data: held } = await supabase
    .from("bets")
    .select("user_id, bet_type, side, voided_at")
    .eq("game_id", source.game_id)
    .in(
      "user_id",
      bettors.map((b) => b.userId),
    );
  const already = ((held ?? []) as Array<{
    user_id: string;
    bet_type: string;
    side: string | null;
    voided_at: string | null | undefined;
  }>).some(
    (h) => !h.voided_at && h.bet_type === source.bet_type && h.side === source.side,
  );
  if (already) return { ok: false, message: "Already on their ledger" };

  const { error } = await supabase.from("bets").insert(
    bettors.map((bettor) => ({
      season_id: source.season_id,
      user_id: bettor.userId,
      logged_by: bettor.loggedBy,
      game_id: source.game_id,
      bet_type: source.bet_type,
      description: source.description,
      side: source.side,
      team_side: source.team_side,
      // Already stored home-perspective; copied as stored, not re-flipped.
      line_taken: source.line_taken === null ? null : Number(source.line_taken),
      odds: source.odds,
      units: Number(source.units),
      confidence: "bet",
    })),
  );

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  revalidatePath("/groups", "layout");
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
  /* Every void, not only a proxy one (LOGF-7): your own bets are on the
     group's sheet and its who-bet-what page too, and a void made from there
     has to clear there. */
  revalidatePath("/groups", "layout");
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

"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { EVERYONE, GAMES_SCOPE_COOKIE } from "../../lib/games-scope";
import { createClient } from "../../lib/supabase/server";

/**
 * The daily game layer's writes (R2-C1/C2). Thin couriers — the RPCs are the
 * boundary (0057's snapshot refusal, 0058's kickoff lock), the same posture
 * as survivor.ts.
 */

export interface DailyGameResult {
  ok: boolean;
  message?: string;
}

const A_YEAR = 60 * 60 * 24 * 365;

/**
 * Remember which pool the viewer competes in on the game layer (R3-E1).
 *
 * The ONLY writer of `cfb_games` — `setActiveGroup` owns `cfb_group`, and a
 * `?g=` in a URL writes neither. Tapping a chip is a choice and is what
 * lands here; following a link is a view and is not.
 */
export async function setGamesScope(scope: string): Promise<void> {
  const value = scope === EVERYONE ? EVERYONE : scope.trim();
  if (!value || (value !== EVERYONE && !/^[a-z0-9-]{1,64}$/.test(value))) return;
  (await cookies()).set(GAMES_SCOPE_COOKIE, value, {
    path: "/",
    maxAge: A_YEAR,
    sameSite: "lax",
  });
  // Every game page and the hub read it.
  revalidatePath("/games");
  revalidatePath("/guess-lines");
  revalidatePath("/streak");
  revalidatePath("/guess-game");
  revalidatePath("/six-pack");
}

export async function submitLineGuess(gameId: number, guess: number): Promise<DailyGameResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to play" };
  if (!Number.isInteger(gameId)) return { ok: false, message: "Bad game" };
  if (!Number.isFinite(guess)) return { ok: false, message: "Enter a spread, e.g. -3.5" };

  const { error } = await supabase.rpc("make_line_guess", {
    p_game: gameId,
    p_guess: guess,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/guess-lines");
  return { ok: true };
}

export async function makeStreakPick(
  day: string,
  side: "home" | "away",
): Promise<DailyGameResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to play" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, message: "Bad day" };
  if (side !== "home" && side !== "away") return { ok: false, message: "Bad side" };

  const { error } = await supabase.rpc("make_streak_pick", { p_day: day, p_side: side });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/streak");
  return { ok: true };
}

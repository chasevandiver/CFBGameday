"use server";

import { revalidatePath } from "next/cache";
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

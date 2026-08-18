/**
 * Chains' server-side reads. `chains.ts` stays pure; this is the half that
 * touches the database. Nothing here writes — the route owns the only write.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_DAILY, type DailyStats } from "./daily-stats";
import {
  EMPTY_RUN,
  chainsStanding,
  type ChainsCard,
  type ChainsKind,
  type ChainsRunState,
} from "./chains";

export interface ChainsDay {
  deck: ChainsCard[];
  /** Crest art for any side that is about one team. */
  crests: Record<number, { school: string; abbr: string; color: string | null; logo: string | null }>;
}

/**
 * The day's deck, in order.
 *
 * Returns the WHOLE deck including every answer, because the route needs it to
 * grade and to reveal the tail once a run ends. `chainsPayload` is the single
 * place that decides which of it a player may see.
 */
export async function fetchChainsDay(
  db: SupabaseClient,
  day: string,
): Promise<ChainsDay | null> {
  const { data: rows } = await db
    .from("chains_cards")
    .select(
      "idx, kind, prompt, left_label, left_sub, left_team, right_label, right_sub, right_team, left_value, right_value, answer",
    )
    .eq("day", day)
    .order("idx");

  const cards = (rows ?? []) as Array<{
    idx: number;
    kind: string;
    prompt: string;
    left_label: string;
    left_sub: string;
    left_team: number | null;
    right_label: string;
    right_sub: string;
    right_team: number | null;
    left_value: number;
    right_value: number;
    answer: "left" | "right";
  }>;
  if (cards.length === 0) return null;

  const deck: ChainsCard[] = cards.map((c) => ({
    kind: c.kind as ChainsKind,
    prompt: c.prompt,
    left: { label: c.left_label, sub: c.left_sub, teamId: c.left_team },
    right: { label: c.right_label, sub: c.right_sub, teamId: c.right_team },
    leftValue: Number(c.left_value),
    rightValue: Number(c.right_value),
    answer: c.answer,
  }));

  const teamIds = [
    ...new Set(deck.flatMap((c) => [c.left.teamId, c.right.teamId]).filter((id): id is number => id !== null)),
  ];
  const crests: ChainsDay["crests"] = {};
  if (teamIds.length > 0) {
    const { data: teams } = await db
      .from("teams")
      .select("id, school, abbreviation, color, logo_url")
      .in("id", teamIds);
    for (const t of (teams ?? []) as Array<{
      id: number;
      school: string;
      abbreviation: string | null;
      color: string | null;
      logo_url: string | null;
    }>) {
      crests[t.id] = {
        school: t.school,
        abbr: t.abbreviation ?? "",
        color: t.color,
        logo: t.logo_url,
      };
    }
  }

  return { deck, crests };
}

/** The caller's own run for today, or a fresh one. */
export async function fetchChainsRun(
  db: SupabaseClient,
  userId: string,
  day: string,
): Promise<ChainsRunState> {
  const { data } = await db
    .from("chains_runs")
    .select("length, busted, answers, ended_at")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();
  return (data as ChainsRunState | null) ?? EMPTY_RUN;
}

/**
 * The caller's record. **Runs still in progress are filtered out** — the same
 * rule GTG-10 had to state for unfinished days: a drive somebody walked away
 * from is not a result yet.
 */
export async function fetchChainsStanding(
  db: SupabaseClient,
  userId: string,
): Promise<DailyStats> {
  const [{ data: runs }, { data: sizes }] = await Promise.all([
    db.from("chains_runs").select("day, length, ended_at").eq("user_id", userId),
    db.from("chains_puzzles").select("day, deck_size"),
  ]);
  const sizeByDay = new Map(
    ((sizes ?? []) as Array<{ day: string; deck_size: number }>).map((r) => [r.day, r.deck_size]),
  );
  const rows = ((runs ?? []) as Array<{ day: string; length: number; ended_at: string | null }>)
    .filter((r) => r.ended_at !== null)
    .map((r) => ({
      day: r.day,
      length: r.length,
      deckSize: sizeByDay.get(r.day) ?? Number.MAX_SAFE_INTEGER,
    }));
  return rows.length === 0 ? EMPTY_DAILY : chainsStanding(rows);
}

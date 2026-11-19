/**
 * What Jarvis needs to turn a sentence into a bet (JARVIS-1): who the owner
 * may log for, and which games are near enough to be the one meant.
 *
 * Both are read as the owner, so RLS decides what is visible, and the people
 * list is not computed here at all — every candidate is put to
 * `can_log_bet_for`, the same question the insert policy asks. A roster query
 * that disagreed with the grant would show Jarvis a name it then cannot log
 * for, which is a worse failure than a short list.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sportOfSeasonId, type Sport } from "./league";
import { canLogBetFor } from "./log-for";
import { fetchBetFormGames, fetchCurrentSeasonWeek } from "./queries";

export interface DoorPerson {
  id: string;
  name: string;
}

export interface DoorTeam {
  name: string;
  abbr: string | null;
  mascot: string | null;
  alt: string[];
}

export interface DoorGame {
  id: number;
  sport: Sport;
  start: string | null;
  status: string;
  home: DoorTeam;
  away: DoorTeam;
}

export interface DoorContext {
  me: DoorPerson;
  people: DoorPerson[];
  games: DoorGame[];
}

/** PostgREST puts an `in` list in the URL; a basketball window is ~700 teams. */
const IN_CHUNK = 150;

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function namesOf(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", ids);
  for (const p of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
    names.set(p.id, p.display_name ?? "");
  }
  return names;
}

/** Current members of the live betting groups the owner runs, minus the owner — then the grant. */
export async function fetchDoorPeople(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<DoorPerson[]> {
  const { data: mine } = await supabase
    .from("group_members")
    .select("group_id, role, removed_at")
    .eq("user_id", ownerId)
    .eq("role", "admin")
    .is("removed_at", null);
  const groupIds = ((mine ?? []) as Array<{ group_id: string }>).map((m) => m.group_id);
  if (groupIds.length === 0) return [];

  const { data: groups } = await supabase
    .from("groups")
    .select("id, kind, archived_at")
    .in("id", groupIds)
    .eq("kind", "betting")
    .is("archived_at", null);
  const betting = ((groups ?? []) as Array<{ id: string }>).map((g) => g.id);
  if (betting.length === 0) return [];

  const { data: roster } = await supabase
    .from("group_members")
    .select("user_id, removed_at")
    .in("group_id", betting)
    .is("removed_at", null);
  const ids = [
    ...new Set(((roster ?? []) as Array<{ user_id: string }>).map((m) => m.user_id)),
  ].filter((id) => id !== ownerId);

  const allowed = await Promise.all(
    ids.map(async (id) => ((await canLogBetFor(supabase, id)) ? id : null)),
  );
  const granted = allowed.filter((id): id is string => id !== null);
  const names = await namesOf(supabase, granted);
  return granted
    .map((id) => ({ id, name: names.get(id) ?? "" }))
    .filter((p) => p.name !== "")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The bet form's own window of games (`fetchBetFormGames`), with the teams named. */
export async function fetchDoorGames(supabase: SupabaseClient): Promise<DoorGame[]> {
  const { seasonId } = await fetchCurrentSeasonWeek(supabase, "cfb");
  const { data: games } = await fetchBetFormGames(supabase, seasonId);

  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const teams = new Map<number, DoorTeam>();
  for (const part of chunks(teamIds, IN_CHUNK)) {
    const { data } = await supabase
      .from("teams")
      .select("id, school, abbreviation, mascot, alt_names")
      .in("id", part);
    for (const t of (data ?? []) as Array<{
      id: number;
      school: string;
      abbreviation: string | null;
      mascot: string | null;
      alt_names: string[] | null;
    }>) {
      teams.set(t.id, {
        name: t.school,
        abbr: t.abbreviation,
        mascot: t.mascot,
        alt: t.alt_names ?? [],
      });
    }
  }

  const out: DoorGame[] = [];
  for (const g of games) {
    const home = teams.get(g.home_team_id);
    const away = teams.get(g.away_team_id);
    // A game whose teams cannot be named cannot be matched to a sentence.
    if (!home || !away) continue;
    out.push({
      id: g.id,
      sport: sportOfSeasonId(g.season_id),
      start: g.start_ts,
      status: g.status,
      home,
      away,
    });
  }
  return out;
}

export async function fetchDoorContext(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<DoorContext> {
  const [names, people, games] = await Promise.all([
    namesOf(supabase, [ownerId]),
    fetchDoorPeople(supabase, ownerId),
    fetchDoorGames(supabase),
  ]);
  return { me: { id: ownerId, name: names.get(ownerId) ?? "" }, people, games };
}

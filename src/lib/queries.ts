import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GameRow,
  LineSnapshotRow,
  PickRow,
  PredictionRow,
  ProfileRow,
  TeamRow,
} from "./db-types";

export interface SlateGame {
  game: GameRow;
  home: TeamRow;
  away: TeamRow;
  /** Latest snapshot per canonical consensus (avg across providers at latest capture) */
  currentSpread: number | null;
  openSpread: number | null;
  currentTotal: number | null;
  prediction: PredictionRow | null;
  myPick: PickRow | null;
}

/** Consensus of the most recent snapshot per provider. */
export function consensusFromSnapshots(snapshots: LineSnapshotRow[]): {
  spread: number | null;
  open: number | null;
  total: number | null;
} {
  const latestByProvider = new Map<string, LineSnapshotRow>();
  for (const s of snapshots) {
    const prev = latestByProvider.get(s.provider);
    if (!prev || s.captured_at > prev.captured_at) latestByProvider.set(s.provider, s);
  }
  const latest = [...latestByProvider.values()];
  const avg = (vals: Array<number | null>): number | null => {
    const nums = vals.filter((v): v is number => v !== null);
    if (nums.length === 0) return null;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
  };
  return {
    spread: avg(latest.map((s) => s.spread)),
    open: avg(latest.map((s) => s.spread_open ?? s.spread)),
    total: avg(latest.map((s) => s.total)),
  };
}

export async function fetchSlate(
  supabase: SupabaseClient,
  seasonId: number,
  week: number,
  userId: string | null,
): Promise<SlateGame[]> {
  const { data: games, error } = await supabase
    .from("games")
    .select("*")
    .eq("season_id", seasonId)
    .eq("week", week)
    .order("start_ts", { ascending: true });
  if (error) throw error;
  if (!games || games.length === 0) return [];

  const gameIds = (games as GameRow[]).map((g) => g.id);
  const teamIds = [
    ...new Set((games as GameRow[]).flatMap((g) => [g.home_team_id, g.away_team_id])),
  ];

  const [teamsRes, linesRes, predsRes, picksRes] = await Promise.all([
    supabase.from("teams").select("*").in("id", teamIds),
    supabase.from("line_snapshots").select("*").in("game_id", gameIds),
    supabase
      .from("predictions")
      .select("*")
      .in("game_id", gameIds)
      .order("created_at", { ascending: false }),
    userId
      ? supabase.from("picks").select("*").in("game_id", gameIds).eq("user_id", userId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const teams = new Map(((teamsRes.data ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const linesByGame = new Map<number, LineSnapshotRow[]>();
  for (const s of (linesRes.data ?? []) as LineSnapshotRow[]) {
    const arr = linesByGame.get(s.game_id) ?? [];
    arr.push(s);
    linesByGame.set(s.game_id, arr);
  }
  // newest prediction wins; prefer frozen rows
  const predByGame = new Map<number, PredictionRow>();
  for (const p of (predsRes.data ?? []) as PredictionRow[]) {
    const existing = predByGame.get(p.game_id);
    if (!existing || (p.frozen && !existing.frozen)) predByGame.set(p.game_id, p);
  }
  const pickByGame = new Map(
    ((picksRes.data ?? []) as PickRow[]).map((p) => [p.game_id, p]),
  );

  return (games as GameRow[]).flatMap((game) => {
    const home = teams.get(game.home_team_id);
    const away = teams.get(game.away_team_id);
    if (!home || !away) return [];
    const consensus = consensusFromSnapshots(linesByGame.get(game.id) ?? []);
    return [
      {
        game,
        home,
        away,
        currentSpread: consensus.spread,
        openSpread: consensus.open,
        currentTotal: consensus.total,
        prediction: predByGame.get(game.id) ?? null,
        myPick: pickByGame.get(game.id) ?? null,
      },
    ];
  });
}

export async function fetchCurrentSeasonWeek(
  supabase: SupabaseClient,
): Promise<{ seasonId: number; week: number }> {
  const { data: season } = await supabase
    .from("seasons")
    .select("id, week0_start")
    .eq("is_current", true)
    .maybeSingle();
  if (!season) return { seasonId: 2026, week: 1 };

  const week0 = new Date(`${season.week0_start}T00:00:00Z`).getTime();
  const elapsedWeeks = Math.floor((Date.now() - week0) / (7 * 24 * 60 * 60 * 1000));
  // CFBD numbers the opening slate week 1; clamp pre-season to week 1 too
  return { seasonId: season.id, week: Math.min(Math.max(elapsedWeeks + 1, 1), 15) };
}

export async function fetchProfiles(supabase: SupabaseClient): Promise<ProfileRow[]> {
  const { data } = await supabase.from("profiles").select("*").order("display_name");
  return (data ?? []) as ProfileRow[];
}

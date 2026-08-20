import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMyGroups } from "./groups";
import { seasonIdsForYear, seasonYearOf } from "./league";
import { fetchCurrentSeasonWeek } from "./queries";
import { byLeagueRules, tallyBy, formatRecord, type Wager } from "./records";
import { betSideLabel, lineForSide, pickSideLabel } from "./slate";
import type {
  PoolFinish,
  WorstBeatRow,
  WrappedBetRow,
  WrappedInput,
  WrappedPickRow,
} from "./wrapped";

/**
 * The Slate Wrapped's loader (R5-C). Query shapes are `fetchHomeData`'s —
 * group picks under RLS, own bets, one games/teams pass for labels — plus
 * the cover-flip join for the worst beat. Everything Wrapped shows is data
 * RLS already shows the viewer: no definer functions, no service role, and
 * graded picks are post-kickoff by construction.
 */

interface PickRowDb {
  group_id: string;
  user_id: string;
  game_id: number;
  market: "spread" | "total" | "straight_up";
  side: string;
  line_at_pick: number | null;
  result: "win" | "loss" | "push" | "void" | null;
  units: number;
  clv: number | null;
}
interface BetRowDb {
  id: number;
  game_id: number | null;
  bet_type: string;
  side: string | null;
  line_taken: number | null;
  result: "win" | "loss" | "push" | "void" | null;
  units: number;
  payout_units: number | null;
  clv: number | null;
  placed_at: string;
}
interface GameRowDb {
  id: number;
  start_ts: string | null;
  home_team_id: number;
  away_team_id: number;
}
interface FlipRowDb {
  game_id: number;
  market: string;
  to_side: string;
  seconds_left: number | null;
  last_play: string | null;
}

/**
 * Wrapped unlocks when the CFB season is over: nothing left on its schedule
 * and a postseason final on the books. (The Super Bowl postdates the natty;
 * the page's header says NFL bets are included as graded by unlock.)
 */
export async function wrappedUnlocked(supabase: SupabaseClient): Promise<boolean> {
  const { seasonId } = await fetchCurrentSeasonWeek(supabase, "cfb");
  const [openRes, postRes] = await Promise.all([
    supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("season_id", seasonId)
      .in("status", ["scheduled", "in_progress"]),
    supabase
      .from("games")
      .select("id")
      .eq("season_id", seasonId)
      .eq("season_type", "postseason")
      .eq("status", "final")
      .limit(1),
  ]);
  return (openRes.count ?? 1) === 0 && (postRes.data ?? []).length > 0;
}

export async function fetchWrappedInput(
  supabase: SupabaseClient,
  userId: string,
): Promise<WrappedInput> {
  const { seasonId } = await fetchCurrentSeasonWeek(supabase, "cfb");
  const year = seasonYearOf(seasonId);
  const seasonIds = seasonIdsForYear(year);

  const mine = await fetchMyGroups(supabase, userId);
  const pickemGroups = mine.filter((g) => g.kind === "pickem");
  const pickemIds = pickemGroups.map((g) => g.id);

  const [pickRes, betRes] = await Promise.all([
    pickemIds.length > 0
      ? supabase
          .from("picks")
          .select("group_id, user_id, game_id, market, side, line_at_pick, result, units, clv")
          .in("group_id", pickemIds)
          .in("season_id", seasonIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("bets")
      .select("id, game_id, bet_type, side, line_taken, result, units, payout_units, clv, placed_at")
      .in("season_id", seasonIds)
      .eq("user_id", userId)
      .is("voided_at", null)
      .order("placed_at", { ascending: true }),
  ]);
  const allPicks = (pickRes.data ?? []) as PickRowDb[];
  const bets = (betRes.data ?? []) as BetRowDb[];
  const myPicks = allPicks.filter((p) => p.user_id === userId);

  // One games/teams pass for kickoffs and labels.
  const gameIds = [
    ...new Set([
      ...myPicks.map((p) => p.game_id),
      ...bets.map((b) => b.game_id).filter((id): id is number => id !== null),
    ]),
  ];
  const games = new Map<number, GameRowDb>();
  const abbrs = new Map<number, string>();
  if (gameIds.length > 0) {
    const { data: gameRows } = await supabase
      .from("games")
      .select("id, start_ts, home_team_id, away_team_id")
      .in("id", gameIds);
    for (const g of (gameRows ?? []) as GameRowDb[]) games.set(g.id, g);
    const teamIds = [
      ...new Set([...games.values()].flatMap((g) => [g.home_team_id, g.away_team_id])),
    ];
    if (teamIds.length > 0) {
      const { data: teamRows } = await supabase
        .from("teams")
        .select("id, abbreviation")
        .in("id", teamIds);
      for (const t of (teamRows ?? []) as { id: number; abbreviation: string | null }[]) {
        abbrs.set(t.id, t.abbreviation ?? "—");
      }
    }
  }
  const abbrsOf = (gameId: number): { home: string; away: string } => {
    const g = games.get(gameId);
    return g
      ? { home: abbrs.get(g.home_team_id) ?? "—", away: abbrs.get(g.away_team_id) ?? "—" }
      : { home: "—", away: "—" };
  };

  // Who else picked each (game, market, side) — the contrarian's evidence.
  // Graded pool picks are post-kickoff-visible under RLS by construction.
  const sideCounts = new Map<string, number>();
  const gamePickers = new Map<string, Set<string>>();
  for (const p of allPicks) {
    const gk = `${p.group_id}:${p.game_id}:${p.market}`;
    sideCounts.set(`${gk}:${p.side}`, (sideCounts.get(`${gk}:${p.side}`) ?? 0) + 1);
    const set = gamePickers.get(gk) ?? new Set<string>();
    set.add(p.user_id);
    gamePickers.set(gk, set);
  }

  const picks: WrappedPickRow[] = myPicks.map((p) => {
    const { home, away } = abbrsOf(p.game_id);
    const gk = `${p.group_id}:${p.game_id}:${p.market}`;
    return {
      result: p.result,
      units: p.units,
      clv: p.clv,
      label: pickSideLabel(p.market, p.side, p.line_at_pick, home, away, { compact: true }),
      line:
        p.market === "spread" && (p.side === "home" || p.side === "away")
          ? lineForSide(p.side, p.line_at_pick)
          : null,
      kickoff: games.get(p.game_id)?.start_ts ?? null,
      soleSide: (sideCounts.get(`${gk}:${p.side}`) ?? 0) === 1,
      pickersOnGame: gamePickers.get(gk)?.size ?? 1,
    };
  });

  const wrappedBets: WrappedBetRow[] = bets.map((b) => {
    const { home, away } = b.game_id !== null ? abbrsOf(b.game_id) : { home: "—", away: "—" };
    return {
      result: b.result,
      units: Number(b.units),
      payoutUnits: b.payout_units === null ? null : Number(b.payout_units),
      clv: b.clv === null ? null : Number(b.clv),
      label: betSideLabel(b.bet_type, b.side, b.line_taken, home, away),
      sideLine:
        b.bet_type === "spread" && (b.side === "home" || b.side === "away")
          ? lineForSide(b.side, b.line_taken)
          : null,
    };
  });

  // The worst beat: cover flips whose landing side went against a losing
  // spread/total wager of the viewer's, on games they were actually on.
  const losingSides = new Map<string, string>(); // `${gameId}:${market}` -> label
  for (const p of myPicks) {
    if (p.result === "loss" && (p.market === "spread" || p.market === "total")) {
      const { home, away } = abbrsOf(p.game_id);
      losingSides.set(
        `${p.game_id}:${p.market}:${p.side}`,
        pickSideLabel(p.market, p.side, p.line_at_pick, home, away, { compact: true }),
      );
    }
  }
  for (const b of bets) {
    if (b.result === "loss" && b.game_id !== null && (b.bet_type === "spread" || b.bet_type === "total")) {
      const { home, away } = abbrsOf(b.game_id);
      losingSides.set(
        `${b.game_id}:${b.bet_type}:${b.side}`,
        betSideLabel(b.bet_type, b.side, b.line_taken, home, away),
      );
    }
  }
  let beats: WorstBeatRow[] = [];
  if (losingSides.size > 0) {
    const flipGameIds = [...new Set([...losingSides.keys()].map((k) => Number(k.split(":")[0])))];
    const { data: flipRows } = await supabase
      .from("cover_flips")
      .select("game_id, market, to_side, seconds_left, last_play")
      .in("game_id", flipGameIds);
    beats = ((flipRows ?? []) as FlipRowDb[]).flatMap((f) => {
      // The flip landed on to_side; the hurt party held the other side.
      const hurtSide = [...losingSides.keys()].find(
        (k) => k.startsWith(`${f.game_id}:${f.market}:`) && !k.endsWith(`:${f.to_side}`),
      );
      return hurtSide
        ? [{ label: losingSides.get(hurtSide)!, secondsLeft: f.seconds_left, lastPlay: f.last_play }]
        : [];
    });
  }

  // Pool finishes, ranked exactly the way the standings rank (League Rules).
  const pools: PoolFinish[] = [];
  for (const g of pickemGroups) {
    const groupPicks = allPicks.filter((p) => p.group_id === g.id);
    const tallies = tallyBy(
      groupPicks.map((p): PickRowDb & Wager => p),
      (p) => p.user_id,
    );
    const rankedIds = [...tallies.entries()]
      .filter(([, t]) => t.decided > 0)
      .sort((a, b) => byLeagueRules(a[1], b[1]))
      .map(([id]) => id);
    const rank = rankedIds.indexOf(userId);
    if (rank === -1) continue;
    pools.push({
      name: g.name,
      rank: rank + 1,
      size: rankedIds.length,
      record: formatRecord(tallies.get(userId)!),
    });
  }

  return { year, picks, bets: wrappedBets, beats, pools };
}

/** A posed season for `?preview=1` — fixtures, never partial real data. */
export function demoWrappedInput(): WrappedInput {
  const k = (m: number, d: number) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T18:00:00Z`;
  const win = (label: string, line: number | null, kickoff: string, over: Partial<WrappedPickRow> = {}): WrappedPickRow => ({
    result: "win",
    units: 1,
    clv: 0.5,
    label,
    line,
    kickoff,
    soleSide: false,
    pickersOnGame: 6,
    ...over,
  });
  const loss = (label: string, kickoff: string): WrappedPickRow => ({
    result: "loss",
    units: 1,
    clv: -0.4,
    label,
    line: -3,
    kickoff,
    soleSide: false,
    pickersOnGame: 6,
  });
  return {
    year: 2026,
    picks: [
      win("UGA -7", -7, k(9, 5)),
      win("AUB +6.5", 6.5, k(9, 12)),
      loss("TEX -2.5", k(9, 19)),
      win("VAN +10", 10, k(9, 26), { soleSide: true, pickersOnGame: 7 }),
      win("OU -3", -3, k(10, 3)),
      win("USC +4", 4, k(10, 10)),
      loss("BAMA -9", k(10, 17)),
      win("ORE -6", -6, k(10, 24)),
      win("IU +3.5", 3.5, k(10, 31)),
      loss("LSU -3", k(11, 7)),
      win("MICH -1", -1, k(11, 14)),
      win("OSU -5", -5, k(11, 21)),
    ],
    bets: [
      { result: "win", units: 2, payoutUnits: 1.8, clv: 1.2, label: "KC -3", sideLine: -3 },
      { result: "loss", units: 1, payoutUnits: -1, clv: -0.5, label: "O 48.5", sideLine: null },
      { result: "win", units: 1, payoutUnits: 0.9, clv: 0.8, label: "DET +2.5", sideLine: 2.5 },
      { result: "win", units: 3, payoutUnits: 2.7, clv: 1.5, label: "BUF -6", sideLine: -6 },
      { result: "loss", units: 2, payoutUnits: -2, clv: 0.2, label: "PHI -4", sideLine: -4 },
      { result: "win", units: 1, payoutUnits: 0.9, clv: 0.6, label: "U 41.5", sideLine: null },
      { result: "loss", units: 1, payoutUnits: -1, clv: -0.9, label: "DAL ML", sideLine: null },
    ],
    beats: [{ label: "OSU -6.5", secondsLeft: 31, lastPlay: "Backdoor screen goes 38 yards to the 1, kneel-down declined, walk-in TD." }],
    pools: [
      { name: "The Pool", rank: 2, size: 8, record: "9-3" },
      { name: "Degens", rank: 4, size: 6, record: "8-4" },
    ],
  };
}

/**
 * Hand-written row types for the tables the app reads.
 * Regenerate with `supabase gen types` once the project is linked; keep the
 * shapes in sync with supabase/migrations/.
 */

import type { PickMarket } from "./grade";

export type { PickMarket };

export interface TeamRow {
  id: number;
  school: string;
  mascot: string | null;
  abbreviation: string | null;
  conference: string | null;
  classification: string;
  color: string | null;
  alt_color: string | null;
  logo_url: string | null;
}

export interface GameRow {
  id: number;
  season_id: number;
  week: number;
  season_type: string;
  start_ts: string | null;
  neutral_site: boolean;
  venue_id: number | null;
  home_team_id: number;
  away_team_id: number;
  home_points: number | null;
  away_points: number | null;
  status: string;
  conference_game?: boolean;
  current_period: number | null;
  current_clock: string | null;
  current_situation: string | null;
  last_play: string | null;
  possession: "home" | "away" | null;
  tv: string | null;
}

export interface LineSnapshotRow {
  id: number;
  game_id: number;
  provider: string;
  source: string;
  spread: number | null;
  spread_open: number | null;
  total: number | null;
  total_open: number | null;
  ml_home: number | null;
  ml_away: number | null;
  captured_at: string;
}

/** One row per game from the line_consensus view (migration 0015). */
export interface LineConsensusRow {
  game_id: number;
  spread: number | null;
  spread_open: number | null;
  total: number | null;
  total_open: number | null;
  ml_home: number | null;
  ml_away: number | null;
  /** Newest snapshot feeding this consensus (migration 0024) — when the line was captured. */
  as_of: string | null;
}

/** A late ATS/total swing caught live by the scoreboard poll (migration 0026). */
export interface CoverFlipRow {
  id: number;
  game_id: number;
  season_id: number;
  week: number;
  market: "spread" | "total";
  line: number;
  from_side: string;
  to_side: string;
  home_points: number;
  away_points: number;
  prev_home_points: number;
  prev_away_points: number;
  period: number | null;
  clock: string | null;
  seconds_left: number | null;
  last_play: string | null;
  winner_changed: boolean;
  detected_at: string;
}

export interface PredictionRow {
  id: number;
  game_id: number;
  season_id: number | null;
  model_version: string;
  frozen: boolean;
  spread: number;
  total: number | null;
  home_score: number | null;
  away_score: number | null;
  home_win_prob: number;
  cover_prob: number | null;
  vegas_spread: number | null;
  edge: number | null;
  edge_flag: "EDGE" | "BIG_EDGE" | null;
  consensus_flag: boolean;
  /** Consensus opener, captured at freeze. Context for the movement, not graded. */
  open_spread: number | null;
  /** Consensus at kickoff. Written by the Sunday grader, null until then. */
  close_spread: number | null;
  /** Signed value of vegas_spread vs close_spread in the edge's direction. */
  clv: number | null;
  created_at: string;
}

export interface PollRankingRow {
  season_id: number;
  week: number;
  season_type: string;
  poll: string;
  team_id: number;
  rank: number;
  points: number | null;
  first_place_votes: number | null;
  fetched_at: string;
}

export interface ProfileRow {
  id: string;
  display_name: string;
  favorite_team_ids: number[];
  is_admin: boolean;
}

export type GroupKind = "pickem" | "betting" | "survivor";

export interface GroupRow {
  id: string;
  name: string;
  slug: string;
  visibility: "private" | "public";
  /** `pickem` runs an admin's board; `betting` is a lens over members' own
   *  ledgers, with no board and no picks at all (migration 0027); `survivor` is
   *  one team a week, no repeats, wrong answer and you are out (0053). */
  kind: GroupKind;
  /** Others' picks are unreadable until each game kicks off (migration 0023). */
  picks_hidden_until_kickoff: boolean;
  /** Pick'em league scope (0042): cfb by default, admin can open nfl or both.
   *  Meaningless on betting groups — the sheet follows the bets. */
  leagues: Array<"cfb" | "nfl">;
  join_code: string;
  created_by: string;
  created_at: string;
  archived_at: string | null;
}

export interface GroupMemberRow {
  group_id: string;
  user_id: string;
  role: "admin" | "member";
  joined_at: string;
  /** Removal is soft, so a departed member's graded picks still resolve. */
  removed_at: string | null;
}

export type SelectionMode = "handpicked" | "full_slate" | "conference";

export interface GroupWeekConfigRow {
  group_id: string;
  season_id: number;
  week: number;
  season_type: string;
  selection_mode: SelectionMode;
  /** Set iff selection_mode is 'conference'. */
  conference: string | null;
  markets: PickMarket[];
  /** League Rules #6, per group. 0 = no minimum. */
  min_picks_per_week: number;
  /** Stamped when the freeze job materialised the list. Not the lock itself —
   *  group_week_is_locked() reads the clock. */
  locked_at: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface PickRow {
  id: number;
  season_id: number;
  group_id: string;
  user_id: string;
  game_id: number;
  market: PickMarket;
  side: "home" | "away" | "over" | "under";
  /** Null for straight_up, which takes no number. A check constraint keeps the
   *  two priced markets from being written without one (migration 0021). */
  line_at_pick: number | null;
  units: number;
  locked_at: string;
  result: "win" | "loss" | "push" | "void" | null;
  clv: number | null;
}

export interface BetRow {
  id: number;
  season_id: number;
  user_id: string;
  game_id: number | null;
  bet_type: string;
  description: string;
  side: string | null;
  line_taken: number | null;
  odds: number;
  units: number;
  book: string | null;
  reason_tag: string;
  placed_at: string;
  closing_line: number | null;
  clv: number | null;
  result: "win" | "loss" | "push" | "void" | null;
  payout_units: number | null;
  voided_at: string | null;
  confidence: ConfidenceTier;
}

/**
 * Self-assigned conviction, low to high (migration 0045). Ordered, and the
 * order is load-bearing — the share card sorts on the index into this tuple,
 * so a reordering silently reorders every card. Append, don't rearrange.
 *
 * A `lean` is the bottom rung of this same ladder, not a separate unstaked
 * thing: still a real bet with real units, just the one you would defend
 * least. `slate` prints its broadcast window at render time from the bet's own
 * kickoff (`kickSlot()` in kick.ts), which is why there is no "afternoon" here.
 *
 * Not null: the column is NOT NULL DEFAULT 'bet', so nothing downstream
 * branches on an absent tier.
 */
export const CONFIDENCE_TIERS = [
  "lean",
  "bet",
  "slate",
  "day",
  "year",
  "century",
] as const;

export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];

/** Singular — the card prints one heading over a group, not one per row. */
export const CONFIDENCE_TIER_LABELS: Record<ConfidenceTier, string> = {
  lean: "Lean",
  bet: "Bet",
  slate: "Bet of the Slate",
  day: "Bet of the Day",
  year: "Bet of the Year",
  century: "Bet of the Century",
};

/**
 * The `bets.bet_type` vocabulary, beside the other two so there is one place to
 * read what a bet can be. Lifted out of `BetForm.tsx` when `/ledger/stats`
 * became a second reader — the form's private `BET_TYPES` was the only
 * definition, and a stats page that grouped by a hardcoded copy of it would
 * drift the first time a type was added.
 *
 * `TEAM_SIDED` / `TOTAL_SIDED` say which sides a type accepts, which is what
 * makes "home vs away" and "over vs under" answerable without asking the row.
 */
export const BET_TYPES = [
  "spread",
  "total",
  "moneyline",
  "team_total",
  "first_half",
  "future",
] as const;

export type BetType = (typeof BET_TYPES)[number];

export const BET_TYPE_LABELS: Record<BetType, string> = {
  spread: "Spread",
  total: "Total",
  moneyline: "Moneyline",
  team_total: "Team total",
  first_half: "1st half",
  future: "Future",
};

/** Sides the grader and live tracker can key on, per bet type. */
export const TEAM_SIDED: ReadonlySet<string> = new Set(["spread", "moneyline", "first_half"]);
export const TOTAL_SIDED: ReadonlySet<string> = new Set(["total", "team_total"]);

export const REASON_TAGS = [
  "model_edge",
  "travel_rest",
  "weather",
  "revenge",
  "qb_news",
  "feel",
  "tail",
  "fade",
] as const;

export const REASON_TAG_LABELS: Record<(typeof REASON_TAGS)[number], string> = {
  model_edge: "Model edge",
  travel_rest: "Travel / rest",
  weather: "Weather",
  revenge: "Revenge",
  qb_news: "QB news",
  feel: "Feel",
  tail: "Tail",
  fade: "Fade",
};

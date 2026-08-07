/**
 * Hand-written row types for the tables the app reads.
 * Regenerate with `supabase gen types` once the project is linked; keep the
 * shapes in sync with supabase/migrations/.
 */

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

export interface PickRow {
  id: number;
  season_id: number;
  user_id: string;
  game_id: number;
  side: "home" | "away" | "over" | "under";
  line_at_pick: number;
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
}

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

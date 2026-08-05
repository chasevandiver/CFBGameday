/** Payload for the slim gameday score-ticker strip (spec §7). */

export interface TickerGame {
  id: number;
  status: string;
  startTs: string | null;
  period: number | null;
  clock: string | null;
  homeAbbr: string;
  awayAbbr: string;
  homePoints: number | null;
  awayPoints: number | null;
}

export interface TickerData {
  seasonId: number;
  week: number;
  games: TickerGame[];
}

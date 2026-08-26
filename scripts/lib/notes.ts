/**
 * Pregame notes' context assembly (F3b) — pure, so vitest owns it and the
 * producer (scripts/generate-notes.ts) stays a thin IO shell, the same split
 * drop.ts keeps for the Tuesday Drop.
 *
 * The whole design constraint lives here: the LLM sees ONLY what these
 * functions put in the prompt — our stored headlines and the model's own
 * stored numbers — so a note can never be better informed than this file,
 * and never worse-grounded than it either. The two cases that motivated the
 * feature set the bar: a projected QB gone (arrives as a stored headline)
 * and a roster/coach exodus a poll hasn't priced (arrives as churn/coaching
 * components against a poll-vs-model rank gap).
 */

import type { TeamNewsRow } from "../../src/lib/db-types";

export interface NotesTeamCtx {
  school: string;
  /** Model rating (points vs average FBS) and 1-based model rank, if rated. */
  rating: number | null;
  modelRank: number | null;
  /** Current human poll rank, when ranked. */
  pollRank: number | null;
  /** Preseason components, when built for this season. */
  churn: number | null;
  coaching: number | null;
}

export interface NotesGameCtx {
  label: string; // "Away at Home"
  week: number;
  neutralSite: boolean;
  home: NotesTeamCtx;
  away: NotesTeamCtx;
  /** Frozen model spread (home-perspective) when the freeze has run. */
  modelSpread: number | null;
  /** Market consensus spread (home-perspective), when lines exist. */
  marketSpread: number | null;
}

const fmt = (n: number): string => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

/**
 * Headlines worth the prompt: fresh only (a stale headline grounds a stale
 * note), newest first, capped per team so a news-heavy program cannot crowd
 * out its opponent. No cross-team dedup — a preview tagging both sides is
 * legitimately context for each.
 */
export function selectNewsForPrompt(
  rows: TeamNewsRow[],
  teamId: number,
  now: Date,
  { maxItems = 8, maxAgeDays = 7 }: { maxItems?: number; maxAgeDays?: number } = {},
): TeamNewsRow[] {
  const cutoff = now.getTime() - maxAgeDays * 24 * 3600 * 1000;
  return rows
    .filter((r) => r.team_id === teamId && Date.parse(r.published_at) >= cutoff)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, maxItems);
}

function teamBlock(t: NotesTeamCtx, news: TeamNewsRow[]): string {
  const lines: string[] = [];
  const rank = [
    t.rating !== null ? `model ${fmt(t.rating)}` : null,
    t.modelRank !== null ? `model rank #${t.modelRank}` : null,
    t.pollRank !== null ? `poll rank #${t.pollRank}` : "unranked in the polls",
  ]
    .filter(Boolean)
    .join(", ");
  lines.push(`${t.school}: ${rank}.`);
  const comps = [
    t.churn !== null ? `roster churn ${fmt(t.churn)}` : null,
    t.coaching !== null && t.coaching !== 0 ? `coaching change ${fmt(t.coaching)}` : null,
  ].filter(Boolean);
  if (comps.length > 0) lines.push(`Preseason adjustments (points): ${comps.join(", ")}.`);
  if (news.length === 0) {
    lines.push("No stored headlines this week.");
  } else {
    lines.push("Headlines (newest first):");
    for (const n of news) {
      const desc = n.description ? ` — ${n.description}` : "";
      lines.push(`- [${n.published_at.slice(0, 10)}] ${n.headline}${desc}`);
    }
  }
  return lines.join("\n");
}

/** The one user message the producer sends per game. */
export function buildNotesPrompt(
  ctx: NotesGameCtx,
  homeNews: TeamNewsRow[],
  awayNews: TeamNewsRow[],
  season: number,
): string {
  const linePart = [
    ctx.modelSpread !== null ? `our frozen model line ${fmt(ctx.modelSpread)} (home)` : null,
    ctx.marketSpread !== null ? `market consensus ${fmt(ctx.marketSpread)} (home)` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    `Matchup: ${ctx.label}${ctx.neutralSite ? " (neutral site)" : ""}, ${season} week ${ctx.week}.`,
    linePart ? `Lines: ${linePart}.` : "Lines: none posted yet.",
    "",
    teamBlock(ctx.away, awayNews),
    "",
    teamBlock(ctx.home, homeNews),
    "",
    `Write the pregame notes for ${ctx.label}, or none.`,
  ].join("\n");
}

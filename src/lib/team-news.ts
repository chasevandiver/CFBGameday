/**
 * Team news off ESPN's unauthenticated site API (F3 v1 — the injury/news scan
 * without the LLM). Discovery is the feed's job; this file only decides what
 * counts as news for a team and how the pages read it back. The classify-into-
 * rating-adjustment layer stays open in docs/STATUS.md.
 *
 * CFBD team ids ARE ESPN team ids — verified against every seed-fixture team
 * (scripts/seed-fixtures.ts) and live article tags on 2026-08-25 — so the feed
 * is queried by `teams.id` directly, no name mapping. `parseTeamNews` refuses
 * any article that does not tag the requested team, which turns an id that
 * ever stops holding into zero rows for that team (visible in the job report)
 * rather than another team's news stored under ours.
 */

import type { TeamNewsRow } from "./db-types";

/** ESPN's team-scoped news feed, one page, newest first. */
export function teamNewsUrl(teamId: number, limit = 20): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/college-football/news?team=${teamId}&limit=${limit}`;
}

export interface EspnNewsArticle {
  id?: number;
  type?: string;
  headline?: string;
  description?: string | null;
  published?: string;
  premium?: boolean;
  links?: { web?: { href?: string } };
  categories?: Array<{ type?: string; teamId?: number }>;
}

export interface EspnNewsFeed {
  articles?: EspnNewsArticle[];
}

/** What the producer upserts — TeamNewsRow minus the DB-defaulted fetched_at. */
export type TeamNewsInsert = Omit<TeamNewsRow, "fetched_at">;

/**
 * An article tagging more teams than this is a league listicle ("NFL training
 * camp players returning to college football?" tags 68), not team news. Real
 * team items tag 1–4; a game preview tags 2. The cut only needs to separate
 * those two clusters, and anywhere in 5–15 does.
 */
const LISTICLE_TEAM_TAGS = 6;

/** Distinct team ids an article tags (ESPN repeats each team in categories). */
function taggedTeams(a: EspnNewsArticle): Set<number> {
  const ids = new Set<number>();
  for (const c of a.categories ?? []) {
    if (c.type === "team" && typeof c.teamId === "number") ids.add(c.teamId);
  }
  return ids;
}

/**
 * The feed page → rows worth storing for `teamId`. Drops:
 * - `Media` — video clips; the reportable event always also arrives as
 *   HeadlineNews/Story (the QB1 fixture pair pins this),
 * - league listicles (see LISTICLE_TEAM_TAGS),
 * - articles that do not tag the requested team (id-drift guard, above),
 * - anything without the fields a row needs.
 */
export function parseTeamNews(feed: EspnNewsFeed, teamId: number): TeamNewsInsert[] {
  const rows: TeamNewsInsert[] = [];
  for (const a of feed.articles ?? []) {
    if (typeof a.id !== "number" || !a.headline || !a.published || !a.type) continue;
    if (a.type === "Media") continue;
    const teams = taggedTeams(a);
    if (!teams.has(teamId) || teams.size > LISTICLE_TEAM_TAGS) continue;
    rows.push({
      team_id: teamId,
      article_id: a.id,
      type: a.type,
      headline: a.headline,
      description: a.description ?? null,
      url: a.links?.web?.href ?? null,
      premium: a.premium ?? false,
      published_at: a.published,
      // published is RFC3339 from ESPN; stored as-is, Postgres parses it.
    });
  }
  return rows;
}

export const NEWS_MAX_AGE_DAYS = 7;

/**
 * What a page shows from stored rows: fresh only (the producer covers a team
 * while it is on the slate, so without the age cut an off-week team's page
 * would present three-week-old rows as "news"), newest first, deduped by
 * article — a game preview tagging both sides is stored once per team and
 * must render once — and capped for the glance.
 */
export function recentTeamNews(
  rows: TeamNewsRow[],
  now: Date,
  { maxItems = 6, maxAgeDays = NEWS_MAX_AGE_DAYS }: { maxItems?: number; maxAgeDays?: number } = {},
): TeamNewsRow[] {
  const cutoff = now.getTime() - maxAgeDays * 24 * 3600 * 1000;
  const seen = new Set<number>();
  return rows
    .filter((r) => Date.parse(r.published_at) >= cutoff)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .filter((r) => (seen.has(r.article_id) ? false : (seen.add(r.article_id), true)))
    .slice(0, maxItems);
}

/** "2h ago" / "3d ago" for the meta line. Floors at "now"; never negative. */
export function agoLabel(publishedAt: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(publishedAt)) / 60000));
  if (mins < 60) return mins <= 1 ? "now" : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

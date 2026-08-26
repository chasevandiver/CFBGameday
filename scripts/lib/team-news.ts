import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTeamNews, teamNewsUrl } from "../../src/lib/team-news";
import { SEASON } from "./ingest";

type Json = Record<string, unknown>;

/**
 * F3 v1 — the daily news pull (the "morning intel" producer, docs/ROADMAP.md
 * §2), scoped exactly as SPEC.md scoped the LLM scan it replaces: teams
 * playing in the next 7 days, not all 136. One unauthenticated ESPN request
 * per slate team, ~30–60 on a normal week; no CFBD calls, no API key, no LLM.
 *
 * Upserts are the idempotency: a re-run rewrites the same (team, article)
 * rows, and ESPN's in-place headline edits overwrite stale copy. A team whose
 * feed fails stays in `failures` rather than failing the run — one team's
 * outage must not cost the other fifty their morning pull. `articles: 0` for
 * a team that demonstrably has news is the tell that its CFBD id has stopped
 * being its ESPN id (src/lib/team-news.ts explains the guard); the repair is
 * a row in the job output, not a silent wrong feed.
 */
export async function teamNewsJob(db: SupabaseClient): Promise<Json> {
  const now = Date.now();
  const horizon = new Date(now + 7 * 24 * 3600 * 1000).toISOString();
  const { data: games, error } = await db
    .from("games")
    .select("home_team_id, away_team_id")
    .eq("season_id", SEASON)
    .eq("status", "scheduled")
    .gt("start_ts", new Date(now).toISOString())
    .lte("start_ts", horizon);
  if (error) throw new Error(error.message);

  const teamIds = [
    ...new Set(
      ((games ?? []) as Array<{ home_team_id: number; away_team_id: number }>).flatMap((g) => [
        g.home_team_id,
        g.away_team_id,
      ]),
    ),
  ];

  let articles = 0;
  const failures: number[] = [];
  for (const teamId of teamIds) {
    let rows;
    try {
      const res = await fetch(teamNewsUrl(teamId));
      if (!res.ok) throw new Error(`ESPN news ${res.status} for team ${teamId}`);
      rows = parseTeamNews(await res.json(), teamId);
    } catch {
      failures.push(teamId);
      continue;
    }
    if (rows.length === 0) continue;
    const { error: upsertErr } = await db
      .from("team_news")
      .upsert(rows, { onConflict: "team_id,article_id" });
    if (upsertErr) failures.push(teamId);
    else articles += rows.length;
  }
  return { teams: teamIds.length, articles, failures };
}

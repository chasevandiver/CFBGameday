import { describe, expect, it } from "vitest";
import type { TeamNewsRow } from "../../src/lib/db-types";
import { buildNotesPrompt, selectNewsForPrompt, type NotesGameCtx } from "./notes";

const row = (
  article_id: number,
  team_id: number,
  published_at: string,
  headline = `h${article_id}`,
): TeamNewsRow => ({
  team_id,
  article_id,
  type: "HeadlineNews",
  headline,
  description: null,
  url: null,
  premium: false,
  published_at,
  fetched_at: published_at,
});

describe("selectNewsForPrompt", () => {
  const now = new Date("2026-08-26T12:00:00Z");

  it("keeps only the requested team, fresh, newest first, capped", () => {
    const rows = [
      row(1, 333, "2026-08-25T12:00:00Z"),
      row(2, 61, "2026-08-25T12:00:00Z"), // other team
      row(3, 333, "2026-08-10T12:00:00Z"), // stale
      row(4, 333, "2026-08-26T09:00:00Z"),
    ];
    expect(selectNewsForPrompt(rows, 333, now).map((r) => r.article_id)).toEqual([4, 1]);
    expect(selectNewsForPrompt(rows, 333, now, { maxItems: 1 }).map((r) => r.article_id)).toEqual([
      4,
    ]);
  });
});

describe("buildNotesPrompt", () => {
  const ctx: NotesGameCtx = {
    label: "Texas Tech at Utah",
    week: 1,
    neutralSite: false,
    away: {
      school: "Texas Tech",
      rating: 12.3,
      modelRank: 1,
      pollRank: 9,
      churn: -0.1,
      coaching: null,
    },
    // The motivating case: ranked in the poll, while the model's own churn and
    // coaching numbers already carry the exodus — the prompt must put all
    // three in front of the LLM or the note it exists for cannot be written.
    home: {
      school: "Utah",
      rating: 2.1,
      modelRank: 38,
      pollRank: 11,
      churn: -5.2,
      coaching: -1.5,
    },
    modelSpread: 4.5,
    marketSpread: 2.5,
  };

  it("carries the poll-vs-model gap and the components", () => {
    const p = buildNotesPrompt(ctx, [], [], 2026);
    expect(p).toContain("Utah: model +2.1, model rank #38, poll rank #11.");
    expect(p).toContain("roster churn -5.2, coaching change -1.5");
    expect(p).toContain("our frozen model line +4.5 (home), market consensus +2.5 (home)");
  });

  it("says when a team has no headlines rather than omitting the section", () => {
    const p = buildNotesPrompt(ctx, [], [row(1, 2641, "2026-08-25T12:00:00Z", "QB banned")], 2026);
    expect(p).toContain("No stored headlines this week.");
    expect(p).toContain("- [2026-08-25] QB banned");
  });

  it("degrades to 'none posted yet' before lines exist", () => {
    const p = buildNotesPrompt({ ...ctx, modelSpread: null, marketSpread: null }, [], [], 2026);
    expect(p).toContain("Lines: none posted yet.");
  });
});

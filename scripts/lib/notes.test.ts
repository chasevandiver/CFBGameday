import { describe, expect, it } from "vitest";
import type { TeamNewsRow } from "../../src/lib/db-types";
import { headlineNotes, marketNote, notesForGame, type MarketTeamCtx } from "./notes";

const row = (
  article_id: number,
  team_id: number,
  headline: string,
  published_at = "2026-08-25T12:00:00Z",
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

const now = new Date("2026-08-26T12:00:00Z");

describe("headlineNotes", () => {
  // Headlines are verbatim from the live feed the day the rules were written.
  it("flags the availability class: QB naming, season loss, dismissal, ban", () => {
    const news = [
      row(1, 333, "Sources: Alabama names Keelon Russell QB1 for opener vs. ECU"),
      row(2, 30, "USC loses starting center Kilian O'Connor for season"),
      row(3, 2628, "TCU dismisses transfer safety Fields over violation of team rules"),
      row(4, 2641, "Texas Tech QB banned by NCAA for betting on games"),
    ];
    for (const [teamId, school] of [
      [333, "Alabama"],
      [30, "USC"],
      [2628, "TCU"],
      [2641, "Texas Tech"],
    ] as const) {
      const notes = headlineNotes(news, teamId, school, now);
      expect(notes).toHaveLength(1);
      expect(notes[0]!.kind).toBe("availability");
      expect(notes[0]!.note.startsWith(`${school}: `)).toBe(true);
    }
  });

  it("does not flag ordinary stories, and 'season' alone is not a match", () => {
    const news = [
      row(1, 333, "Ryan Coleman-Williams is looking to shake off his sophomore slump"),
      row(2, 2628, "College football 2026: How to get the most fun out of the season"),
      // The observed false-positive class, deliberately unmatched: an NFL
      // alum story tagged to his college. No "retires" rule exists for it.
      row(3, 61, "Former Browns, Texans RB Nick Chubb announces retirement"),
    ];
    expect(headlineNotes(news, 333, "Alabama", now)).toEqual([]);
    expect(headlineNotes(news, 2628, "TCU", now)).toEqual([]);
    expect(headlineNotes(news, 61, "Georgia", now)).toEqual([]);
  });

  it("classifies portal moves as roster and coach headlines as coaching", () => {
    const news = [
      row(1, 254, "Utah head coach steps down two weeks before the opener"),
      row(2, 254, "Starting Utah corner enters the portal"),
    ];
    const kinds = headlineNotes(news, 254, "Utah", now).map((n) => n.kind);
    expect(kinds).toContain("coaching");
    expect(kinds).toContain("roster");
  });

  it("drops stale headlines", () => {
    const news = [row(1, 333, "Alabama names X QB1", "2026-08-10T12:00:00Z")];
    expect(headlineNotes(news, 333, "Alabama", now)).toEqual([]);
  });
});

describe("marketNote", () => {
  // The motivating case: still ranked #11 while the model's own churn and
  // coaching numbers already carry the exodus.
  const utah: MarketTeamCtx = {
    school: "Utah",
    modelRank: 38,
    pollRank: 11,
    churn: -5.2,
    coaching: -1.5,
  };

  it("writes the poll-high note with the components as the printed cause", () => {
    expect(marketNote(utah)?.note).toBe(
      "Utah is #11 in the poll but #38 in our model — the preseason build already docks 5.2 pts of roster churn and 1.5 for the coaching change.",
    );
  });

  it("fires on the board's own loudest case — TTU at an 11-spot gap", () => {
    // The gap that set MARKET_GAP to 10: model #1 vs AP #12 must not be the
    // disagreement the notes stay quiet about.
    expect(
      marketNote({ school: "Texas Tech", modelRank: 1, pollRank: 12, churn: null, coaching: null })
        ?.note,
    ).toBe("Our model has Texas Tech #1, well ahead of their #12 poll rank.");
  });

  it("writes the model-high and unranked directions too", () => {
    expect(
      marketNote({ school: "Tulane", modelRank: 8, pollRank: 24, churn: null, coaching: null })
        ?.note,
    ).toBe("Our model has Tulane #8, well ahead of their #24 poll rank.");
    expect(
      marketNote({ school: "Memphis", modelRank: 9, pollRank: null, churn: null, coaching: null })
        ?.note,
    ).toBe("Memphis is unranked in the polls, but our model has them #9.");
  });

  it("stays silent inside the gap, and on unrated teams", () => {
    expect(
      marketNote({ school: "Georgia", modelRank: 3, pollRank: 1, churn: -2, coaching: null }),
    ).toBeNull();
    expect(
      marketNote({ school: "An FCS team", modelRank: null, pollRank: null, churn: null, coaching: null }),
    ).toBeNull();
  });
});

describe("notesForGame", () => {
  const quiet: MarketTeamCtx = {
    school: "Q",
    modelRank: 40,
    pollRank: null,
    churn: null,
    coaching: null,
  };

  it("zero notes is the normal case", () => {
    expect(notesForGame([], quiet, quiet)).toEqual([]);
  });

  it("availability outranks market at the cap", () => {
    const headline = headlineNotes(
      [
        row(1, 1, "Team A names X QB1", "2026-08-25T12:00:00Z"),
        row(2, 1, "Team A loses Y for season", "2026-08-25T13:00:00Z"),
        row(3, 2, "Team B QB suspended", "2026-08-25T14:00:00Z"),
      ],
      1,
      "Team A",
      now,
    ).concat(headlineNotes([row(3, 2, "Team B QB suspended", "2026-08-25T14:00:00Z")], 2, "Team B", now));
    const utah: MarketTeamCtx = {
      school: "Utah",
      modelRank: 38,
      pollRank: 11,
      churn: -5.2,
      coaching: -1.5,
    };
    const notes = notesForGame(headline, utah, quiet);
    expect(notes).toHaveLength(3);
    expect(notes.every((n) => n.kind !== "market")).toBe(true);
    // Newest headline leads.
    expect(notes[0]!.note).toBe("Team B: Team B QB suspended");
  });
});

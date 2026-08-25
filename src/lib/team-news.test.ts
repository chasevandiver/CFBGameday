import { describe, expect, it } from "vitest";
import type { TeamNewsRow } from "./db-types";
import {
  agoLabel,
  parseTeamNews,
  recentTeamNews,
  type EspnNewsArticle,
  type EspnNewsFeed,
} from "./team-news";

/**
 * Fixtures are trimmed verbatim from the live `?team=333` (Alabama) feed,
 * captured 2026-08-25 — the day Alabama named its QB1, which is exactly the
 * event F3 exists for. They pin three separations the parser must keep making:
 * the same event arrives as both a Media clip and a HeadlineNews story (keep
 * one), a league listicle tags 68 teams (keep none), and every category list
 * repeats each team (count distinct, not entries). If ESPN changes the feed
 * shape, these fail before the job stores a single wrong row.
 */

// The reportable event, as text: kept.
const QB1 = {"id": 49692021, "type": "HeadlineNews", "headline": "Sources: Alabama names Keelon Russell QB1 for opener vs. ECU", "description": "Alabama has named Keelon Russell as the starting quarterback for its Sept. 5 season opener against East Carolina, sources told ESPN's Pete Thamel.", "published": "2026-08-25T16:46:38Z", "premium": false, "links": {"web": {"href": "https://www.espn.com/college-football/story/_/id/49692021/sources-alabama-names-keelon-russell-qb1-opener-vs-ecu"}}, "categories": [{"type": "team", "teamId": 333}, {"type": "team", "teamId": 333}]} as EspnNewsArticle;

// The same event as a video clip: dropped, or every story shows up twice.
const QB1_CLIP = {"id": 49723210, "type": "Media", "headline": "What Keelon Russell brings to the table as QB1 for Alabama", "description": "What Keelon Russell brings to the table as QB1 for Alabama", "published": "2026-08-25T16:36:28Z", "premium": false, "links": {"web": {"href": "https://www.espn.com/video/clip/_/id/49723210/what-keelon-russell-brings-table-qb1-alabama"}}, "categories": [{"type": "team", "teamId": 333}, {"type": "team", "teamId": 333}]} as EspnNewsArticle;

const STORY = {"id": 49695141, "type": "Story", "headline": "Ryan Coleman-Williams is looking to shake off his sophomore slump", "description": "The Crimson Tide receiver's second year was plagued by drops and a crisis of confidence. Can he bounce back?", "published": "2026-08-24T11:38:13Z", "premium": false, "links": {"web": {"href": "https://www.espn.com/college-football/story/_/id/49695141/ryan-coleman-williams-alabama-junior-season"}}, "categories": [{"type": "team", "teamId": 333}, {"type": "team", "teamId": 333}]} as EspnNewsArticle;

// League listicle — tagged 68 distinct teams live (Alabama among them);
// categories trimmed to 8 distinct here, still past the cut.
const LISTICLE = {"id": 49710520, "type": "Story", "headline": "NFL training camp players returning to college football? How?", "description": "The new five-for-five rule has players who started college in 2022 seeking a second chance on campus.", "published": "2026-08-24T14:46:26Z", "premium": false, "links": {"web": {"href": "https://www.espn.com/college-football/story/_/id/49710520/college-football-2026-nfl-training-camps-players-return"}}, "categories": [{"type": "team", "teamId": 103}, {"type": "team", "teamId": 103}, {"type": "team", "teamId": 25}, {"type": "team", "teamId": 228}, {"type": "team", "teamId": 150}, {"type": "team", "teamId": 52}, {"type": "team", "teamId": 59}, {"type": "team", "teamId": 97}, {"type": "team", "teamId": 333}]} as EspnNewsArticle;

const FEED: EspnNewsFeed = { articles: [QB1_CLIP, QB1, STORY, LISTICLE] };

describe("parseTeamNews", () => {
  it("keeps the stories, drops the clip and the listicle", () => {
    const rows = parseTeamNews(FEED, 333);
    expect(rows.map((r) => r.article_id)).toEqual([49692021, 49695141]);
  });

  it("maps the row the schema expects", () => {
    const [row] = parseTeamNews({ articles: [QB1] }, 333);
    expect(row).toEqual({
      team_id: 333,
      article_id: 49692021,
      type: "HeadlineNews",
      headline: "Sources: Alabama names Keelon Russell QB1 for opener vs. ECU",
      description:
        "Alabama has named Keelon Russell as the starting quarterback for its Sept. 5 season opener against East Carolina, sources told ESPN's Pete Thamel.",
      url: "https://www.espn.com/college-football/story/_/id/49692021/sources-alabama-names-keelon-russell-qb1-opener-vs-ecu",
      premium: false,
      published_at: "2026-08-25T16:46:38Z",
    });
  });

  it("refuses an article that does not tag the requested team (id-drift guard)", () => {
    // Asking for Georgia (61) against Alabama's feed must store nothing —
    // this is what makes a CFBD-id-stops-being-an-ESPN-id failure visible
    // as zero rows rather than silent wrong attribution.
    expect(parseTeamNews({ articles: [QB1, STORY] }, 61)).toEqual([]);
  });

  it("counts distinct teams, not repeated category entries", () => {
    // ESPN tags every team twice; two entries for one team is team news,
    // not a two-team article.
    const rows = parseTeamNews({ articles: [QB1] }, 333);
    expect(rows).toHaveLength(1);
  });

  it("survives an empty or malformed feed", () => {
    expect(parseTeamNews({}, 333)).toEqual([]);
    expect(parseTeamNews({ articles: [{ type: "Story" }] }, 333)).toEqual([]);
  });
});

const row = (article_id: number, team_id: number, published_at: string): TeamNewsRow => ({
  team_id,
  article_id,
  type: "Story",
  headline: `h${article_id}`,
  description: null,
  url: null,
  premium: false,
  published_at,
  fetched_at: published_at,
});

describe("recentTeamNews", () => {
  const now = new Date("2026-08-25T18:00:00Z");

  it("dedupes a game preview stored under both teams", () => {
    const rows = [row(1, 333, "2026-08-25T12:00:00Z"), row(1, 61, "2026-08-25T12:00:00Z")];
    expect(recentTeamNews(rows, now)).toHaveLength(1);
  });

  it("sorts newest first and caps", () => {
    const rows = [
      row(1, 333, "2026-08-22T12:00:00Z"),
      row(2, 333, "2026-08-25T12:00:00Z"),
      row(3, 333, "2026-08-24T12:00:00Z"),
    ];
    expect(recentTeamNews(rows, now, { maxItems: 2 }).map((r) => r.article_id)).toEqual([2, 3]);
  });

  it("hides stale rows — an off-week team's page shows nothing, not old news", () => {
    expect(recentTeamNews([row(1, 333, "2026-08-10T12:00:00Z")], now)).toEqual([]);
  });
});

describe("agoLabel", () => {
  const now = new Date("2026-08-25T18:00:00Z");
  it("reads minutes, hours, days", () => {
    expect(agoLabel("2026-08-25T17:59:30Z", now)).toBe("now");
    expect(agoLabel("2026-08-25T17:30:00Z", now)).toBe("30m ago");
    expect(agoLabel("2026-08-25T13:00:00Z", now)).toBe("5h ago");
    expect(agoLabel("2026-08-22T18:00:00Z", now)).toBe("3d ago");
  });
  it("never goes negative on clock skew", () => {
    expect(agoLabel("2026-08-25T18:05:00Z", now)).toBe("now");
  });
});

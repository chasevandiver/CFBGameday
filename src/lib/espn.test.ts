import { describe, expect, it } from "vitest";
import {
  nflStoredWeek,
  parseEvent,
  parseEventOdds,
  parseMoneyline,
  spreadFromDetails,
  type EspnEvent,
  type EspnOdds,
} from "./espn";

/**
 * Fixtures are trimmed verbatim from the live scoreboard feed, captured
 * 2026-08-13 (preseason week 2 + the 2026 season openers). They exist to pin
 * the odds sign convention: line_snapshots stores home-perspective spreads
 * (negative = home favored, 0001), and these games' favorites were verified
 * against the book's own `details` string at capture time. If ESPN changes
 * the odds object shape, these tests fail before the ingest writes a single
 * inverted row into an append-only table.
 */

// CIN -7 at home vs DET: home favorite, so home-perspective spread is -7.
const HOME_FAVORITE = {"id": "401873272", "name": "Detroit Lions at Cincinnati Bengals", "date": "2026-08-13T23:00Z", "season": {"year": 2026, "type": 1, "slug": "preseason"}, "week": {"number": 2}, "competitions": [{"neutralSite": false, "timeValid": true, "venue": {"id": "3874", "fullName": "Paycor Stadium", "address": {"city": "Cincinnati", "state": "OH", "country": "USA"}, "indoor": false}, "broadcasts": [], "status": {"displayClock": "0:00", "period": 0, "type": {"name": "STATUS_SCHEDULED", "state": "pre", "completed": false}}, "situation": null, "competitors": [{"homeAway": "home", "score": "0", "team": {"id": "4", "abbreviation": "CIN", "displayName": "Cincinnati Bengals"}}, {"homeAway": "away", "score": "0", "team": {"id": "8", "abbreviation": "DET", "displayName": "Detroit Lions"}}], "odds": [{"provider": {"name": "DraftKings"}, "details": "CIN -7", "spread": -7.0, "overUnder": 38.5, "pointSpread": {"home": {"close": {"line": "-7"}, "open": {"line": "-3.5"}}}, "total": {"over": {"close": {"line": "o38.5"}, "open": {"line": "o38.5"}}}, "moneyline": {"home": {"close": {"odds": "-278"}}, "away": {"close": {"odds": "+225"}}}, "homeTeamOdds": {"favorite": true}, "awayTeamOdds": {"favorite": false}}]}]} as unknown as EspnEvent;

// GB -2.5 on the road at PIT: away favorite, so home-perspective spread is +2.5.
const AWAY_FAVORITE = {"id": "401873275", "name": "Green Bay Packers at Pittsburgh Steelers", "date": "2026-08-13T23:00Z", "season": {"year": 2026, "type": 1, "slug": "preseason"}, "week": {"number": 2}, "competitions": [{"neutralSite": false, "timeValid": true, "venue": {"id": "3752", "fullName": "Acrisure Stadium", "address": {"city": "Pittsburgh", "state": "PA", "country": "USA"}, "indoor": false}, "broadcasts": [{"market": "national", "names": ["NFL Net"]}], "status": {"displayClock": "0:00", "period": 0, "type": {"name": "STATUS_SCHEDULED", "state": "pre", "completed": false}}, "situation": null, "competitors": [{"homeAway": "home", "score": "0", "team": {"id": "23", "abbreviation": "PIT", "displayName": "Pittsburgh Steelers"}}, {"homeAway": "away", "score": "0", "team": {"id": "9", "abbreviation": "GB", "displayName": "Green Bay Packers"}}], "odds": [{"provider": {"name": "DraftKings"}, "details": "GB -2.5", "spread": 2.5, "overUnder": 38.5, "pointSpread": {"home": {"close": {"line": "+2.5"}, "open": {"line": "-1.5"}}}, "total": {"over": {"close": {"line": "o38.5"}, "open": {"line": "o37.5"}}}, "moneyline": {"home": {"close": {"odds": "+124"}}, "away": {"close": {"odds": "-148"}}}, "homeTeamOdds": {"favorite": false}, "awayTeamOdds": {"favorite": true}}]}]} as unknown as EspnEvent;

// Hall of Fame game — final, neutral site, away side won 33–30.
const FINAL_GAME = {"id": "401873271", "name": "Carolina Panthers at Arizona Cardinals", "date": "2026-08-07T00:00Z", "season": {"year": 2026, "type": 1, "slug": "preseason"}, "week": {"number": 1}, "competitions": [{"neutralSite": true, "timeValid": true, "venue": {"id": "3718", "fullName": "Tom Benson Hall of Fame Stadium", "address": {"city": "Canton", "state": "OH", "country": "USA"}, "indoor": false}, "broadcasts": [{"market": "national", "names": ["NBC"]}], "status": {"displayClock": "0:00", "period": 4, "type": {"name": "STATUS_FINAL", "state": "post", "completed": true}}, "situation": null, "competitors": [{"homeAway": "home", "score": "30", "team": {"id": "22", "abbreviation": "ARI", "displayName": "Arizona Cardinals"}}, {"homeAway": "away", "score": "33", "team": {"id": "29", "abbreviation": "CAR", "displayName": "Carolina Panthers"}}]}]} as unknown as EspnEvent;

// 2026 season opener — regular season, broadcast attached, line already posted.
const OPENER_WEEK1 = {"id": "401872656", "name": "New England Patriots at Seattle Seahawks", "date": "2026-09-10T00:20Z", "season": {"year": 2026, "type": 2, "slug": "regular-season"}, "week": {"number": 1}, "competitions": [{"neutralSite": false, "timeValid": true, "venue": {"id": "3673", "fullName": "Lumen Field", "address": {"city": "Seattle", "state": "WA", "country": "USA"}, "indoor": false}, "broadcasts": [{"market": "national", "names": ["NBC"]}], "status": {"displayClock": "0:00", "period": 0, "type": {"name": "STATUS_SCHEDULED", "state": "pre", "completed": false}}, "situation": null, "competitors": [{"homeAway": "home", "score": "0", "team": {"id": "26", "abbreviation": "SEA", "displayName": "Seattle Seahawks"}}, {"homeAway": "away", "score": "0", "team": {"id": "17", "abbreviation": "NE", "displayName": "New England Patriots"}}], "odds": [{"provider": {"name": "DraftKings"}, "details": "SEA -3.5", "spread": -3.5, "overUnder": 44.5, "pointSpread": {"home": {"close": {"line": "-3.5"}, "open": {"line": "-3.5"}}}, "total": {"over": {"close": {"line": "o44.5"}, "open": {"line": "o44.5"}}}, "moneyline": {"home": {"close": {"odds": "-185"}}, "away": {"close": {"odds": "+154"}}}, "homeTeamOdds": {"favorite": true}, "awayTeamOdds": {"favorite": false}}]}]} as unknown as EspnEvent;

const oddsOf = (e: EspnEvent) => e.competitions[0].odds;

describe("parseEventOdds — sign convention", () => {
  it("keeps a home favorite negative", () => {
    const line = parseEventOdds(oddsOf(HOME_FAVORITE), "CIN", "DET");
    expect(line).toEqual({
      provider: "DraftKings",
      spread: -7,
      spreadOpen: -3.5,
      total: 38.5,
      totalOpen: 38.5,
      mlHome: -278,
      mlAway: 225,
    });
  });

  it("keeps an away favorite positive", () => {
    const line = parseEventOdds(oddsOf(AWAY_FAVORITE), "PIT", "GB");
    expect(line).toEqual({
      provider: "DraftKings",
      spread: 2.5,
      spreadOpen: -1.5,
      total: 38.5,
      totalOpen: 37.5,
      mlHome: 124,
      mlAway: -148,
    });
  });

  it("drops a spread the details string contradicts, keeping the total", () => {
    // A sign inversion in an append-only table is unrecoverable; a dropped
    // snapshot costs nothing. Simulate the feed disagreeing with itself.
    const odds = structuredClone(oddsOf(HOME_FAVORITE)) as EspnOdds[];
    odds[0].spread = 7; // flipped vs. "CIN -7"
    const line = parseEventOdds(odds, "CIN", "DET");
    expect(line?.spread).toBeNull();
    expect(line?.spreadOpen).toBeNull(); // no opener without a trusted close
    expect(line?.total).toBe(38.5);
  });

  it("drops a spread the favorite flag contradicts", () => {
    const odds = structuredClone(oddsOf(HOME_FAVORITE)) as EspnOdds[];
    odds[0].details = null; // no details to adjudicate with
    odds[0].homeTeamOdds = { favorite: false };
    const line = parseEventOdds(odds, "CIN", "DET");
    expect(line?.spread).toBeNull();
  });

  it("falls back to the details string when numeric fields are missing", () => {
    const odds = structuredClone(oddsOf(AWAY_FAVORITE)) as EspnOdds[];
    odds[0].spread = null;
    odds[0].pointSpread = null;
    const line = parseEventOdds(odds, "PIT", "GB");
    expect(line?.spread).toBe(2.5); // "GB -2.5", GB away → home +2.5
  });

  it("returns null when the board carries no odds", () => {
    expect(parseEventOdds(undefined, "CIN", "DET")).toBeNull();
    expect(parseEventOdds([], "CIN", "DET")).toBeNull();
  });
});

describe("parseMoneyline", () => {
  it("reads signed American odds", () => {
    expect(parseMoneyline("-278")).toBe(-278);
    expect(parseMoneyline("+225")).toBe(225);
    expect(parseMoneyline("EVEN")).toBe(100);
  });
  it("rejects what it can't read", () => {
    expect(parseMoneyline(null)).toBeNull();
    expect(parseMoneyline("")).toBeNull();
    expect(parseMoneyline("OFF")).toBeNull();
  });
});

describe("spreadFromDetails", () => {
  it("signs by which side the named team is", () => {
    expect(spreadFromDetails("CIN -7", "CIN", "DET")).toBe(-7);
    expect(spreadFromDetails("GB -2.5", "PIT", "GB")).toBe(2.5);
  });
  it("reads a pick'em as zero", () => {
    expect(spreadFromDetails("EVEN", "CIN", "DET")).toBe(0);
    expect(spreadFromDetails("PK", "CIN", "DET")).toBe(0);
  });
  it("refuses an abbreviation that matches neither side", () => {
    expect(spreadFromDetails("KC -3", "CIN", "DET")).toBeNull();
  });
});

describe("parseEvent", () => {
  it("parses a scheduled game without inventing a score", () => {
    const g = parseEvent(OPENER_WEEK1);
    expect(g.id).toBe(401872656);
    expect(g.status).toBe("scheduled");
    // ESPN reports score "0" pregame; a 0–0 scheduled game is not a shutout
    expect(g.homePoints).toBeNull();
    expect(g.awayPoints).toBeNull();
    expect(g.homeEspnId).toBe(26);
    expect(g.awayEspnId).toBe(17);
    expect(g.tv).toBe("NBC");
    expect(g.startTimeTbd).toBe(false);
    expect(g.neutralSite).toBe(false);
    expect(g.venue?.name).toBe("Lumen Field");
    expect(g.espnSeasonType).toBe(2);
    expect(g.espnWeek).toBe(1);
    expect(g.odds?.spread).toBe(-3.5);
  });

  it("parses a final with the score and no live residue", () => {
    const g = parseEvent(FINAL_GAME);
    expect(g.status).toBe("final");
    expect(g.homePoints).toBe(30);
    expect(g.awayPoints).toBe(33);
    expect(g.period).toBeNull();
    expect(g.clock).toBeNull();
    expect(g.possession).toBeNull();
    expect(g.neutralSite).toBe(true);
  });

  it("maps live possession onto home/away", () => {
    // Synthesized from the scheduled fixture: ESPN's situation.possession is
    // the team id of the side with the ball.
    const live = structuredClone(HOME_FAVORITE) as EspnEvent;
    live.competitions[0].status = {
      displayClock: "7:24",
      period: 2,
      type: { name: "STATUS_IN_PROGRESS", state: "in", completed: false },
    };
    live.competitions[0].competitors[0].score = "14";
    live.competitions[0].competitors[1].score = "10";
    live.competitions[0].situation = {
      shortDownDistanceText: "2nd & 6",
      downDistanceText: "2nd & 6 at DET 41",
      possession: "8", // DET, the away side
      lastPlay: { text: "Pass complete for 4 yards" },
    };
    const g = parseEvent(live);
    expect(g.status).toBe("in_progress");
    expect(g.period).toBe(2);
    expect(g.clock).toBe("7:24");
    expect(g.possession).toBe("away");
    // the long form, because it carries the spot the field strip needs
    expect(g.situation).toBe("2nd & 6 at DET 41");
    expect(g.lastPlay).toBe("Pass complete for 4 yards");
    expect(g.homePoints).toBe(14);
    expect(g.awayPoints).toBe(10);
  });

  // ESPN's own kickoff snapshot: the short form is present before the spot is,
  // and a card with the down but no field strip is degraded, not broken.
  it("falls back to the short down-and-distance when there is no spot", () => {
    const live = structuredClone(HOME_FAVORITE) as EspnEvent;
    live.competitions[0].status = {
      displayClock: "15:00",
      period: 1,
      type: { name: "STATUS_IN_PROGRESS", state: "in", completed: false },
    };
    live.competitions[0].situation = { shortDownDistanceText: "1st & 10" };
    expect(parseEvent(live).situation).toBe("1st & 10");
  });
});

describe("nflStoredWeek", () => {
  it("passes regular-season weeks through", () => {
    expect(nflStoredWeek(2, 18, "Chiefs at Raiders")).toEqual({ seasonType: "regular", week: 18 });
  });
  it("maps the bracket and drops the Pro Bowl", () => {
    expect(nflStoredWeek(3, 1, "Wild Card")).toEqual({ seasonType: "postseason", week: 1 });
    expect(nflStoredWeek(3, 3, "AFC Championship")).toEqual({ seasonType: "postseason", week: 3 });
    expect(nflStoredWeek(3, 4, "Pro Bowl Games")).toBeNull();
    expect(nflStoredWeek(3, 5, "Super Bowl LXI")).toEqual({ seasonType: "postseason", week: 4 });
  });
  it("stores preseason 1:1 — August games are real games", () => {
    expect(nflStoredWeek(1, 1, "Hall of Fame Game")).toEqual({ seasonType: "preseason", week: 1 });
    expect(nflStoredWeek(1, 2, "Lions at Bengals")).toEqual({ seasonType: "preseason", week: 2 });
  });
});

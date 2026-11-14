import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/cbb-feed.json";
import {
  CBB_FEED_PROVIDER,
  cbbModelVersion,
  feedIsReadable,
  feedPrediction,
  feedSnapshot,
  isCbbModelVersion,
  nextSlateIsAhead,
  predictionChanged,
  snapshotChanged,
  trustedMarket,
  type FeedRecord,
} from "./cbb-feed";
import { modelClv } from "./clv";
import { modelSideOf } from "./slate";

/**
 * Records are verbatim from the cbbmodel feed (`public/feed/cbb/`), captured
 * 2026-11-11. They pin the two sign conventions the importer straddles —
 * spreads agree with this app, edges are the other way round — against real
 * games whose favourites are stated independently in the feed.
 */
const fx = fixtures as unknown as {
  header: { schema_version: string; kind: string; sport: string };
  HOME_FAV_BEST_BET: FeedRecord;
  AWAY_FAV: FeedRecord;
  MOVED_CLOSE: FeedRecord;
};

describe("feedIsReadable", () => {
  it("accepts schema 1.x slate files for cbb and nothing else", () => {
    expect(feedIsReadable(fx.header)).toBe(true);
    expect(feedIsReadable({ ...fx.header, schema_version: "2.0" })).toBe(false);
    expect(feedIsReadable({ ...fx.header, sport: "nba" })).toBe(false);
    expect(feedIsReadable({ ...fx.header, kind: "season" })).toBe(false);
  });
});

describe("feedPrediction — sign convention", () => {
  it("keeps the spread and reverses the edge (away favourite, model likes home)", () => {
    // Florida A&M +6.5 at home; the model makes it Florida A&M +1.3. The feed
    // calls that a +5.2 edge and bets the home side.
    const rec = fx.AWAY_FAV;
    expect(rec.market!.spread_home).toBe(6.5);
    expect(rec.bet.side).toBe("home");
    const p = feedPrediction(rec)!;
    expect(p.spread).toBe(1.3);
    expect(p.vegas_spread).toBe(6.5);
    // this app: edge = model − market, NEGATIVE means the model likes home
    expect(p.edge).toBe(-5.2);
    expect(modelSideOf({ edge: p.edge, edgeFlag: p.edge_flag })).toBe("home");
    expect(p.edge_flag).toBe("BIG_EDGE");
    expect(p.frozen).toBe(true);
    expect(p.model_version).toBe("cbb-4.1.0");
  });

  it("scales win probability to 0–1 and carries the projected score", () => {
    const p = feedPrediction(fx.AWAY_FAV)!;
    expect(p.home_win_prob).toBeGreaterThan(0);
    expect(p.home_win_prob).toBeLessThan(1);
    expect(p.home_win_prob).toBeCloseTo(fx.AWAY_FAV.model.home_win_prob! / 100, 6);
    expect(p.home_score! + p.away_score!).toBeCloseTo(p.total!, 0);
    // the projected margin and the spread are the same fact
    expect(p.away_score! - p.home_score!).toBeCloseTo(p.spread, 0);
  });

  it("flags a value play that is not a best bet as EDGE, and agrees with the feed's side", () => {
    // Texas Tech −28.5 at home, model −21.9: the model is on the dog.
    const p = feedPrediction(fx.MOVED_CLOSE)!;
    expect(p.edge).toBe(6.6);
    expect(p.edge_flag).toBe("EDGE");
    expect(modelSideOf({ edge: p.edge, edgeFlag: p.edge_flag })).toBe(fx.MOVED_CLOSE.bet.side);
  });

  it("measures CLV the way the grader will", () => {
    // The model is on the dog at +28.5 (home −28.5) and it closed +30.5: the
    // market moved AWAY from the model, which took two points fewer than the
    // close was giving. That is −2, and it is the feed's own flat-CLV story.
    const p = feedPrediction(fx.MOVED_CLOSE)!;
    expect(modelClv(p.edge, p.vegas_spread, fx.MOVED_CLOSE.closing!.spread_home)).toBe(-2);
  });

  it("prices a game with no line as a prediction with no edge", () => {
    const rec = { ...fx.AWAY_FAV, market: null, closing: null };
    const p = feedPrediction(rec)!;
    expect(p.vegas_spread).toBeNull();
    expect(p.edge).toBeNull();
    expect(p.edge_flag).toBeNull();
    expect(feedSnapshot(rec, "2026-11-11T15:00:00Z")).toBeNull();
  });

  it("refuses a record with no spread or no win probability", () => {
    const rec = fx.AWAY_FAV;
    expect(feedPrediction({ ...rec, model: { ...rec.model, spread_home: null } })).toBeNull();
    expect(feedPrediction({ ...rec, model: { ...rec.model, home_win_prob: null } })).toBeNull();
    expect(feedPrediction({ ...rec, game_id: "not-a-number" })).toBeNull();
  });
});

describe("trustedMarket — a line that contradicts itself", () => {
  // Saint Joseph's (home) vs South Florida, neutral floor. Published as home
  // −7.5 while `favorite` reads "USF -7.5": the away side.
  const rec = fx.HOME_FAV_BEST_BET;

  it("is the record this guard was written for", () => {
    expect(rec.market!.spread_home).toBe(-7.5);
    expect(rec.market!.favorite).toBe("USF -7.5");
    expect(rec.away.abbr).toBe("USF");
  });

  it("drops the spread, keeps the total, and takes the edge with it", () => {
    const mk = trustedMarket(rec, rec.market)!;
    expect(mk.spread_home).toBeNull();
    expect(mk.total).toBe(151.5);
    const p = feedPrediction(rec)!;
    expect(p.vegas_spread).toBeNull();
    expect(p.edge).toBeNull();
    expect(p.edge_flag).toBeNull();
    const snap = feedSnapshot(rec, "2026-11-11T15:00:00Z")!;
    expect(snap.spread).toBeNull();
    expect(snap.total).toBe(151.5);
  });

  it("trusts a line whose favourite agrees, by abbreviation or by name", () => {
    expect(trustedMarket(fx.AWAY_FAV, fx.AWAY_FAV.market)!.spread_home).toBe(6.5);
    expect(trustedMarket(fx.MOVED_CLOSE, fx.MOVED_CLOSE.market)!.spread_home).toBe(-28.5);
    const flipped = { ...rec.market!, favorite: "JOES -7.5" };
    expect(trustedMarket(rec, flipped)!.spread_home).toBe(-7.5);
  });

  it("does not hold an unreadable favourite against the line", () => {
    for (const favorite of [null, "", "Somebody Else", "EVEN"]) {
      expect(trustedMarket(rec, { ...rec.market!, favorite })!.spread_home).toBe(-7.5);
    }
    expect(trustedMarket(rec, null)).toBeNull();
  });
});

describe("feedSnapshot", () => {
  it("prefers the feed's latest snapshot and keeps the pick-time line as the opener", () => {
    const snap = feedSnapshot(fx.MOVED_CLOSE, "2026-11-12T12:00:00Z")!;
    expect(snap.provider).toBe(CBB_FEED_PROVIDER);
    expect(snap.spread).toBe(-30.5);
    expect(snap.spread_open).toBe(-28.5);
    expect(snap.total).toBe(149.5);
    // the feed's own stamp, which is before tip
    expect(Date.parse(snap.captured_at)).toBe(Date.parse(fx.MOVED_CLOSE.closing!.captured_at!));
    expect(Date.parse(snap.captured_at)).toBeLessThan(Date.parse(fx.MOVED_CLOSE.start_time));
  });

  it("stamps an unstamped pregame line now", () => {
    const rec = { ...fx.AWAY_FAV, start_time: "2026-11-11T23:00:00Z" };
    const snap = feedSnapshot(rec, "2026-11-11T15:00:00Z")!;
    expect(snap.captured_at).toBe("2026-11-11T15:00:00.000Z");
    expect(snap.spread).toBe(6.5);
    expect(snap.spread_open).toBe(6.5);
  });

  it("never dates a pregame line after tip", () => {
    const rec = { ...fx.AWAY_FAV, start_time: "2026-11-11T23:00:00Z" };
    const snap = feedSnapshot(rec, "2026-11-12T02:00:00Z")!;
    expect(snap.captured_at).toBe("2026-11-11T22:59:00.000Z");
  });
});

describe("change detection", () => {
  it("appends a snapshot only when a number moved", () => {
    const next = { spread: -30.5, total: 149.5 };
    expect(snapshotChanged(undefined, next)).toBe(true);
    // Postgres numerics arrive as strings
    expect(snapshotChanged({ spread: "-30.5", total: "149.5" }, next)).toBe(false);
    expect(snapshotChanged({ spread: "-28.5", total: "149.5" }, next)).toBe(true);
    expect(snapshotChanged({ spread: null, total: "149.5" }, next)).toBe(true);
  });

  it("writes a prediction once", () => {
    const p = feedPrediction(fx.AWAY_FAV)!;
    expect(predictionChanged(undefined, p)).toBe(true);
    expect(predictionChanged({ spread: "1.3", total: String(p.total), vegas_spread: "6.5" }, p)).toBe(false);
    expect(predictionChanged({ spread: "1.3", total: String(p.total), vegas_spread: null }, p)).toBe(true);
  });
});

describe("model version", () => {
  it("is recognisable and never parses as a CFB version", () => {
    expect(cbbModelVersion("4.1.0")).toBe("cbb-4.1.0");
    expect(cbbModelVersion(null)).toBe("cbb-unknown");
    expect(isCbbModelVersion("cbb-4.1.0")).toBe(true);
    expect(isCbbModelVersion("2026.3.1")).toBe(false);
  });
});

describe("the day-before preview (CBB-14)", () => {
  it("stores an early record unfrozen, marked, with the same numbers", () => {
    const official = feedPrediction(fx.AWAY_FAV)!;
    const early = feedPrediction(fx.AWAY_FAV, { early: true })!;
    expect(official.frozen).toBe(true);
    expect(official.adjustments.early).toBeUndefined();
    expect(early.frozen).toBe(false);
    expect(early.adjustments.early).toBe(true);
    expect({ ...early, frozen: true, adjustments: official.adjustments }).toEqual(official);
  });

  it("takes a next slate only when it is dated after the published one", () => {
    const published = { slate_date: "2026-11-14" };
    const next = { ...fx.header, slate_date: "2026-11-15" };
    expect(nextSlateIsAhead(published, next)).toBe(true);
    // the morning run has published the day the preview was for
    expect(nextSlateIsAhead({ slate_date: "2026-11-15" }, next)).toBe(false);
    expect(nextSlateIsAhead({ slate_date: "2026-11-16" }, next)).toBe(false);
    expect(nextSlateIsAhead(published, { ...next, slate_date: undefined })).toBe(false);
    expect(nextSlateIsAhead({}, next)).toBe(false);
    expect(nextSlateIsAhead(published, { ...next, schema_version: "2.0" })).toBe(false);
    expect(nextSlateIsAhead(published, { ...next, kind: "season" })).toBe(false);
  });
});

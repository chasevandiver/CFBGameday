import { describe, expect, it } from "vitest";
import { liveWinProb } from "../model/live";
import { OT_BAND_END, flowExtremes, gameFlowPoints, pregameMarginFor } from "./game-flow";
import type { ScoringPlayRow } from "./scoring";

const play = (
  sequence: number,
  period: number | null,
  clock: string | null,
  home: number,
  away: number,
  team: number | null = null,
): ScoringPlayRow => ({
  game_id: 1,
  sequence,
  period,
  clock,
  scoring_team_id: team,
  play_type: null,
  play_text: `play ${sequence}`,
  home_points: home,
  away_points: away,
  source: "test",
});

describe("pregameMarginFor", () => {
  it("CFB leads with the frozen model spread, negated to liveWinProb's convention", () => {
    expect(pregameMarginFor({ frozenSpread: -6.5, marketClose: -3, sport: "cfb" })).toEqual({
      margin: 6.5,
      source: "model",
    });
  });
  it("CFB without a frozen number falls to the market close", () => {
    expect(pregameMarginFor({ frozenSpread: null, marketClose: -3, sport: "cfb" })).toEqual({
      margin: 3,
      source: "market",
    });
  });
  it("NFL is market-only by design — a model spread there is ignored", () => {
    expect(pregameMarginFor({ frozenSpread: -6.5, marketClose: 2.5, sport: "nfl" })).toEqual({
      margin: -2.5,
      source: "market",
    });
  });
  it("no number at all means no chart", () => {
    expect(pregameMarginFor({ frozenSpread: null, marketClose: null, sport: "nfl" })).toBeNull();
  });
});

describe("gameFlowPoints", () => {
  const wireToWire = [
    play(0, 1, "8:00", 7, 0),
    play(1, 2, "5:00", 14, 0),
    play(2, 3, "10:00", 21, 3),
    play(3, 4, "6:00", 28, 3),
  ];

  it("anchors at the pregame prob and pins the terminal point to the outcome", () => {
    const { points } = gameFlowPoints({
      plays: wireToWire,
      pregameMargin: 7,
      finalHome: 28,
      finalAway: 3,
    });
    expect(points[0].x).toBe(0);
    expect(points[0].prob).toBeCloseTo(
      liveWinProb({ pregameMargin: 7, homePoints: 0, awayPoints: 0, period: null, clock: null }),
      10,
    );
    const last = points[points.length - 1];
    expect(last.x).toBe(1);
    expect(last.prob).toBe(1);
  });

  it("a wire-to-wire favorite never flips; a comeback flips once", () => {
    const wtw = gameFlowPoints({
      plays: wireToWire,
      pregameMargin: 7,
      finalHome: 28,
      finalAway: 3,
    });
    expect(flowExtremes(wtw.points).flips).toBe(0);

    const comeback = gameFlowPoints({
      plays: [
        play(0, 1, "5:00", 0, 14),
        play(1, 3, "5:00", 0, 17),
        play(2, 4, "4:00", 7, 17),
        play(3, 4, "1:00", 14, 17),
        play(4, 4, "0:04", 21, 17),
      ],
      pregameMargin: 3,
      finalHome: 21,
      finalAway: 17,
    });
    // favored pregame (above 0.5) → buried under 17 (below) → the go-ahead
    // score crosses back: two lead flips, both real
    expect(flowExtremes(comeback.points).flips).toBe(2);
  });

  it("x rises strictly even when a TD and its PAT share a clock", () => {
    const { points } = gameFlowPoints({
      plays: [play(0, 2, "3:00", 6, 0), play(1, 2, "3:00", 7, 0)],
      pregameMargin: 0,
      finalHome: 7,
      finalAway: 0,
    });
    for (let i = 1; i < points.length; i++) expect(points[i].x).toBeGreaterThan(points[i - 1].x);
  });

  it("overtime plays land in the compressed band past 1, in order", () => {
    const { points, overtime } = gameFlowPoints({
      plays: [play(0, 4, "0:30", 14, 14), play(1, 5, "0:00", 20, 14)],
      pregameMargin: 0,
      finalHome: 20,
      finalAway: 14,
    });
    expect(overtime).toBe(true);
    const ot = points.filter((p) => p.mark && (p.period ?? 0) > 4);
    expect(ot).toHaveLength(1);
    expect(ot[0].x).toBeGreaterThan(1);
    expect(ot[0].x).toBeLessThanOrEqual(OT_BAND_END);
    expect(points[points.length - 1].x).toBe(OT_BAND_END);
  });

  it("an unclocked play is counted but never moves the curve", () => {
    const flow = gameFlowPoints({
      plays: [play(0, 2, "8:00", 7, 0), play(1, null, null, 14, 0)],
      pregameMargin: 0,
      finalHome: 14,
      finalAway: 0,
    });
    expect(flow.unclocked).toBe(1);
    expect(flow.points.filter((p) => p.mark)).toHaveLength(1);
  });

  it("no clocked plays means no chart", () => {
    const flow = gameFlowPoints({
      plays: [play(0, null, null, 7, 0)],
      pregameMargin: 3,
      finalHome: 7,
      finalAway: 0,
    });
    expect(flow.points).toEqual([]);
    expect(flow.unclocked).toBe(1);
  });

  it("play points use the score AFTER the play, matching the stored rows", () => {
    const { points } = gameFlowPoints({
      plays: [play(0, 1, "2:00", 7, 0)],
      pregameMargin: 0,
      finalHome: 7,
      finalAway: 0,
    });
    const markPt = points.find((p) => p.mark)!;
    expect(markPt.prob).toBeCloseTo(
      liveWinProb({ pregameMargin: 0, homePoints: 7, awayPoints: 0, period: 1, clock: "2:00" }),
      10,
    );
  });

  it("an NFL tie pins the terminal point to the middle", () => {
    const { points } = gameFlowPoints({
      plays: [play(0, 4, "1:00", 20, 20)],
      pregameMargin: 0,
      finalHome: 20,
      finalAway: 20,
    });
    expect(points[points.length - 1].prob).toBe(0.5);
  });

  it("samples between plays hold the standing score while the clock drains", () => {
    const { points } = gameFlowPoints({
      plays: [play(0, 1, "10:00", 7, 0), play(1, 4, "2:00", 14, 0)],
      pregameMargin: 0,
      finalHome: 14,
      finalAway: 0,
    });
    const between = points.filter((p) => !p.mark && p.x > 0.2 && p.x < 0.9);
    expect(between.length).toBeGreaterThan(5);
    for (const p of between) {
      expect(p.homePoints).toBe(7);
      expect(p.awayPoints).toBe(0);
    }
    // a 7-point lead's prob grows as the clock drains on a pick'em prior
    expect(between[between.length - 1].prob).toBeGreaterThan(between[0].prob);
  });
});

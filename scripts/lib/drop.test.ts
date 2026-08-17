import { describe, expect, it } from "vitest";
import {
  dissents,
  modelRanks,
  pickSubject,
  topMovers,
  weekPair,
  type DropRatingRow,
} from "./drop";

const r = (team_id: number, week: number, overall: number): DropRatingRow => ({
  team_id,
  week,
  overall,
});

describe("weekPair", () => {
  it("newest week and its predecessor", () => {
    expect(weekPair([r(1, 0, 10), r(1, 1, 12), r(1, 2, 11)])).toEqual({ week: 2, prev: 1 });
  });
  it("null with fewer than two weeks — nothing has moved, the producer skips", () => {
    expect(weekPair([r(1, 0, 10), r(2, 0, 8)])).toBeNull();
    expect(weekPair([])).toBeNull();
  });
});

describe("topMovers", () => {
  it("ranks by absolute delta, newest vs previous", () => {
    const rows = [
      r(1, 1, 10), r(1, 2, 16),   // +6
      r(2, 1, 10), r(2, 2, 2),    // -8
      r(3, 1, 10), r(3, 2, 11),   // +1
      r(4, 2, 20),                // no prior week — not a mover
    ];
    const m = topMovers(rows, 2, 1);
    expect(m.map((x) => x.teamId)).toEqual([2, 1, 3]);
    expect(m[0]!.delta).toBe(-8);
  });
});

describe("dissents", () => {
  it("poll minus model, biggest gap first, unrated teams dropped", () => {
    const ranks = modelRanks(
      [r(1, 2, 30), r(2, 2, 20), r(3, 2, 10)],
      2,
    ); // model: 1st, 2nd, 3rd
    const d = dissents(ranks, [
      { team_id: 3, rank: 1 },  // poll #1, our #3 → gap -2
      { team_id: 1, rank: 5 },  // poll #5, our #1 → gap +4
      { team_id: 99, rank: 2 }, // not in our ratings
    ]);
    expect(d.map((x) => x.teamId)).toEqual([1, 3]);
    expect(d[0]!.gap).toBe(4);
  });
});

describe("pickSubject", () => {
  const mover = { teamId: 7, delta: 5, overall: 12 };
  it("a real poll disagreement (gap ≥ 3) carries the drop", () => {
    const s = pickSubject([mover], [{ teamId: 1, pollRank: 5, modelRank: 1, gap: 4 }]);
    expect(s).toEqual({ kind: "dissent", d: { teamId: 1, pollRank: 5, modelRank: 1, gap: 4 } });
  });
  it("with no poll yet, the biggest mover carries it", () => {
    expect(pickSubject([mover], [])).toEqual({ kind: "mover", m: mover });
  });
  it("a small gap defers to the mover", () => {
    const s = pickSubject([mover], [{ teamId: 1, pollRank: 2, modelRank: 1, gap: 1 }]);
    expect(s?.kind).toBe("mover");
  });
  it("nothing to argue → null, and the producer skips rather than padding", () => {
    expect(pickSubject([], [])).toBeNull();
  });
});

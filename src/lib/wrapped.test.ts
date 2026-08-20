import { describe, expect, it } from "vitest";
import {
  buildWrapped,
  type WrappedBetRow,
  type WrappedInput,
  type WrappedPickRow,
} from "./wrapped";

const pick = (over: Partial<WrappedPickRow> = {}): WrappedPickRow => ({
  result: "win",
  units: 1,
  clv: null,
  label: "T1 -3.5",
  line: -3.5,
  kickoff: "2026-09-05T16:00:00Z",
  soleSide: false,
  pickersOnGame: 4,
  ...over,
});

const bet = (over: Partial<WrappedBetRow> = {}): WrappedBetRow => ({
  result: "win",
  units: 1,
  payoutUnits: 0.91,
  clv: null,
  label: "T2 +6",
  sideLine: null,
  ...over,
});

const k = (i: number) => `2026-09-${String(5 + i).padStart(2, "0")}T16:00:00Z`;

const empty: WrappedInput = { year: 2026, picks: [], bets: [], beats: [], pools: [] };

describe("buildWrapped", () => {
  it("an empty season mints nothing — no placeholders", () => {
    expect(buildWrapped(empty)).toEqual([]);
  });

  it("mints the record card from graded picks, League-Rule tallied", () => {
    const cards = buildWrapped({
      ...empty,
      picks: [
        pick({ result: "win", kickoff: k(0) }),
        pick({ result: "loss", kickoff: k(1) }),
        pick({ result: "void", kickoff: k(2) }),
      ],
    });
    const record = cards.find((c) => c.kind === "record")!;
    expect(record.headline).toBe("1-1");
  });

  it("best call prefers the biggest dog that cashed, from picks or bets", () => {
    const cards = buildWrapped({
      ...empty,
      picks: [pick({ result: "win", line: 6.5, label: "AUB +6.5", kickoff: k(0) })],
      bets: [bet({ result: "win", sideLine: 10, label: "VAN +10" })],
    });
    const best = cards.find((c) => c.kind === "bestCall")!;
    expect(best.headline).toBe("VAN +10");
    expect(best.detail).toContain("10-point dog");
  });

  it("without a dog, best call falls to the winner that beat the close", () => {
    const cards = buildWrapped({
      ...empty,
      picks: [
        pick({ result: "win", line: -7, clv: 2.5, label: "UGA -7", kickoff: k(0) }),
        pick({ result: "win", line: -3, clv: 0.5, kickoff: k(1) }),
      ],
    });
    const best = cards.find((c) => c.kind === "bestCall")!;
    expect(best.headline).toBe("UGA -7");
  });

  it("the contrarian requires sole side, a played game, AND a win", () => {
    const lostAlone = buildWrapped({
      ...empty,
      picks: [pick({ result: "loss", soleSide: true, pickersOnGame: 5, kickoff: k(0) })],
    });
    expect(lostAlone.find((c) => c.kind === "contrarian")).toBeUndefined();

    const wonAlone = buildWrapped({
      ...empty,
      picks: [pick({ result: "win", soleSide: true, pickersOnGame: 5, label: "MSST +21", kickoff: k(0) })],
    });
    const card = wonAlone.find((c) => c.kind === "contrarian")!;
    expect(card.headline).toBe("MSST +21");
    expect(card.detail).toContain("4 went the other way");
  });

  it("the heater counts consecutive wins in kickoff order; pushes are no action", () => {
    const cards = buildWrapped({
      ...empty,
      picks: [
        pick({ result: "win", kickoff: k(0) }),
        pick({ result: "push", kickoff: k(1) }),
        pick({ result: "win", kickoff: k(2) }),
        pick({ result: "win", kickoff: k(3) }),
        pick({ result: "loss", kickoff: k(4) }),
        pick({ result: "win", kickoff: k(5) }),
      ],
    });
    expect(cards.find((c) => c.kind === "streak")!.headline).toBe("3 straight");
  });

  it("a two-game run is not a heater", () => {
    const cards = buildWrapped({
      ...empty,
      picks: [pick({ result: "win", kickoff: k(0) }), pick({ result: "win", kickoff: k(1) })],
    });
    expect(cards.find((c) => c.kind === "streak")).toBeUndefined();
  });

  it("the worst beat is the flip that died latest", () => {
    const cards = buildWrapped({
      ...empty,
      beats: [
        { label: "OSU -6.5", secondsLeft: 31, lastPlay: "backdoor TD" },
        { label: "LSU -3", secondsLeft: 240, lastPlay: null },
      ],
    });
    const beat = cards.find((c) => c.kind === "worstBeat")!;
    expect(beat.headline).toBe("OSU -6.5");
    expect(beat.sub).toBe("flipped with 0:31 left");
  });

  it("the truth serum waits for a sample and states the uncomfortable case", () => {
    const few = buildWrapped({
      ...empty,
      picks: [pick({ result: "win", clv: 1, kickoff: k(0) })],
    });
    expect(few.find((c) => c.kind === "clv")).toBeUndefined();

    const winners = Array.from({ length: 12 }, (_, i) =>
      pick({ result: "win", clv: -0.8, kickoff: k(i) }),
    );
    const card = buildWrapped({ ...empty, picks: winners }).find((c) => c.kind === "clv")!;
    expect(card.headline).toContain("−0.80");
    expect(card.detail).toContain("the close beat you");
  });

  it("the crew card leads with the best finish and footnotes the rest", () => {
    const cards = buildWrapped({
      ...empty,
      pools: [
        { name: "Degens", rank: 3, size: 8, record: "30-24" },
        { name: "The Pool", rank: 1, size: 6, record: "33-21" },
      ],
    });
    const crew = cards.find((c) => c.kind === "crew")!;
    expect(crew.headline).toBe("#1");
    expect(crew.detail).toContain("The Pool");
    expect(crew.sub).toContain("Degens");
  });

  it("high water mints only when the peak beat where the season ended", () => {
    const rise = [1, 2, 3, 4, 5].map(() => bet({ result: "win", payoutUnits: 2 }));
    const fall = [1, 2].map(() => bet({ result: "loss", payoutUnits: -3 }));
    const cards = buildWrapped({ ...empty, bets: [...rise, ...fall] });
    const hw = cards.find((c) => c.kind === "highWater")!;
    expect(hw.headline).toBe("+10.0u");
  });
});

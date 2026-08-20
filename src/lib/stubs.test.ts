import { describe, expect, it } from "vitest";
import { stubsFor, type StubPickRow } from "./stubs";

const r = (week: number, result: StubPickRow["result"]): StubPickRow => ({ week, result });

describe("stubsFor", () => {
  it("mints a stub per fully graded week, oldest first", () => {
    const stubs = stubsFor([
      r(2, "win"),
      r(2, "loss"),
      r(1, "win"),
      r(1, "win"),
      r(1, "push"),
    ]);
    expect(stubs).toEqual([
      { week: 1, w: 2, l: 0, p: 1 },
      { week: 2, w: 1, l: 1, p: 0 },
    ]);
  });

  it("an ungraded pick holds the whole week's stub back — and a re-grade to null retracts it", () => {
    expect(stubsFor([r(3, "win"), r(3, null)])).toEqual([]);
  });

  it("a void-only week bought no ticket", () => {
    expect(stubsFor([r(4, "void")])).toEqual([]);
  });

  it("voids inside a graded week count for nothing in either direction", () => {
    expect(stubsFor([r(5, "win"), r(5, "void")])).toEqual([{ week: 5, w: 1, l: 0, p: 0 }]);
  });

  it("no picks, no stubs", () => {
    expect(stubsFor([])).toEqual([]);
  });
});

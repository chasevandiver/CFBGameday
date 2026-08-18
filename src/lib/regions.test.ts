import { describe, expect, it } from "vitest";
import { modalRegion, regionOfState } from "./regions";

describe("regionOfState", () => {
  it("places the states a college football schedule actually visits", () => {
    expect(regionOfState("AL")).toBe("South");
    expect(regionOfState("OH")).toBe("Midwest");
    expect(regionOfState("CA")).toBe("West");
    expect(regionOfState("MA")).toBe("Northeast");
  });
  it("is case and whitespace insensitive — the column is raw CFBD", () => {
    expect(regionOfState(" tx ")).toBe("South");
  });
  it("refuses rather than guesses on anything unrecognised", () => {
    expect(regionOfState(null)).toBeNull();
    expect(regionOfState("")).toBeNull();
    expect(regionOfState("Dublin")).toBeNull();
  });
  it("does not follow conference footprints: UCLA is West, not Midwest", () => {
    // The Big Ten reaches both coasts. Region is geography, not membership.
    expect(regionOfState("CA")).toBe("West");
    expect(regionOfState("NJ")).toBe("Northeast");
  });
});

describe("modalRegion", () => {
  it("takes the region most home venues sit in", () => {
    expect(modalRegion(["TX", "TX", "LA"])).toBe("South");
  });
  it("ignores states it cannot place instead of counting them", () => {
    expect(modalRegion([null, "Dublin", "OH"])).toBe("Midwest");
  });
  it("is null when nothing resolves", () => {
    expect(modalRegion([])).toBeNull();
    expect(modalRegion([null, undefined])).toBeNull();
  });
});

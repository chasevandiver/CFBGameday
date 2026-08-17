import { describe, expect, it } from "vitest";
import { watchLabel, watchOn } from "./watch-on";

describe("watchOn", () => {
  it.each([
    ["ESPN", "ESPN app"],
    ["espn2", "ESPN app"],
    ["SEC Network", "ESPN app"],
    ["ACC Network", "ESPN app"],
    ["Big Ten Network", "Fox Sports app"],
    ["ABC", "ESPN app"],
    ["FOX", "Fox Sports app"],
    ["FS1", "Fox Sports app"],
    ["CBS", "Paramount+"],
    ["CBS Sports Network", "Paramount+"],
    ["NBC", "Peacock"],
    ["Peacock", "Peacock"],
    ["NFL Network", "NFL+"],
    ["Prime Video", "Prime Video"],
    ["Amazon Prime", "Prime Video"],
    ["The CW", "The CW app"],
  ])("%s → %s", (tv, app) => {
    expect(watchOn(tv)?.app).toBe(app);
  });

  it("returns null for an unmapped network and for no network", () => {
    expect(watchOn("Obscure RSN")).toBeNull();
    expect(watchOn(null)).toBeNull();
    expect(watchOn("")).toBeNull();
  });
});

describe("watchLabel", () => {
  it("pairs network with service when mapped", () => {
    expect(watchLabel("CBS")).toBe("CBS · Paramount+");
  });
  it("degrades to the network alone when unmapped — never 'unknown'", () => {
    expect(watchLabel("Obscure RSN")).toBe("Obscure RSN");
  });
  it("null with no network", () => {
    expect(watchLabel(null)).toBeNull();
  });
});

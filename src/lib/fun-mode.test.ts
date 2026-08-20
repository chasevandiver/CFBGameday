import { describe, expect, it } from "vitest";
import {
  FUN_DEFAULTS,
  daypartFor,
  funOn,
  gamedayKind,
  msToNextDaypart,
  normalizeFunPrefs,
  overriddenDaypart,
  overriddenGameday,
  type FunPiece,
} from "./fun-mode";

const at = (day: number, hour: number, minute = 0) => {
  // 2026-08-16 is a Sunday; add days to land where the test wants.
  const d = new Date(2026, 7, 16 + day, hour, minute, 0, 0);
  return d;
};

describe("funOn / defaults", () => {
  it("ships dark: master off means every piece is off, whatever its own toggle says", () => {
    for (const piece of Object.keys(FUN_DEFAULTS).filter((k) => k !== "master")) {
      expect(funOn(FUN_DEFAULTS, piece as FunPiece)).toBe(false);
    }
  });

  it("master on delivers the pieces, which individually opt out", () => {
    const prefs = { ...FUN_DEFAULTS, master: true, cover: false };
    expect(funOn(prefs, "fallLight")).toBe(true);
    expect(funOn(prefs, "cover")).toBe(false);
  });
});

describe("normalizeFunPrefs", () => {
  it("garbage in, defaults out", () => {
    expect(normalizeFunPrefs(null)).toEqual(FUN_DEFAULTS);
    expect(normalizeFunPrefs("yes")).toEqual(FUN_DEFAULTS);
    expect(normalizeFunPrefs(42)).toEqual(FUN_DEFAULTS);
  });

  it("keeps known booleans, drops unknown keys and non-boolean values", () => {
    const p = normalizeFunPrefs({ master: true, cover: "on", pennants: false, extra: true });
    expect(p.master).toBe(true);
    expect(p.cover).toBe(FUN_DEFAULTS.cover);
    expect(p.pennants).toBe(false);
    expect("extra" in p).toBe(false);
  });
});

describe("gamedayKind", () => {
  it("Saturday is college, Sunday is pro, Wednesday is nothing", () => {
    expect(gamedayKind(at(6, 12))).toBe("cfb"); // Sat
    expect(gamedayKind(at(0, 12))).toBe("nfl"); // Sun
    expect(gamedayKind(at(3, 12))).toBeNull(); // Wed
  });
});

describe("daypartFor", () => {
  it("walks the arc of the day at the documented boundaries", () => {
    expect(daypartFor(at(6, 0))).toBe("dawn");
    expect(daypartFor(at(6, 10, 59))).toBe("dawn");
    expect(daypartFor(at(6, 11))).toBe("noon");
    expect(daypartFor(at(6, 14, 59))).toBe("noon");
    expect(daypartFor(at(6, 15))).toBe("golden");
    expect(daypartFor(at(6, 17, 59))).toBe("golden");
    expect(daypartFor(at(6, 18))).toBe("lights");
    expect(daypartFor(at(6, 23, 59))).toBe("lights");
  });
});

describe("msToNextDaypart", () => {
  it("sleeps exactly to the next boundary", () => {
    expect(msToNextDaypart(at(6, 10, 30))).toBe(30 * 60 * 1000);
    expect(msToNextDaypart(at(6, 14, 0))).toBe(60 * 60 * 1000);
    expect(msToNextDaypart(at(6, 17, 59))).toBe(60 * 1000);
  });

  it("after the last boundary it sleeps to midnight, never zero or negative", () => {
    const ms = msToNextDaypart(at(6, 23, 30));
    expect(ms).toBe(30 * 60 * 1000);
    expect(msToNextDaypart(at(6, 23, 59, ))).toBeGreaterThan(0);
  });
});

describe("preview overrides", () => {
  it("?funday poses the gameday; anything else falls back to the calendar", () => {
    const wed = at(3, 12);
    expect(overriddenGameday(new URLSearchParams("funday=sat"), wed)).toBe("cfb");
    expect(overriddenGameday(new URLSearchParams("funday=sun"), wed)).toBe("nfl");
    expect(overriddenGameday(new URLSearchParams("funday=monday"), wed)).toBeNull();
    expect(overriddenGameday(new URLSearchParams(""), at(6, 12))).toBe("cfb");
  });

  it("?daypart poses the light; a typo falls back to the clock", () => {
    const morning = at(6, 9);
    expect(overriddenDaypart(new URLSearchParams("daypart=lights"), morning)).toBe("lights");
    expect(overriddenDaypart(new URLSearchParams("daypart=midnight"), morning)).toBe("dawn");
  });
});

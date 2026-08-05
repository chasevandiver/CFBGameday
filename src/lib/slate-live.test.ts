import { describe, expect, it } from "vitest";
import { liveUrgency, pickCoverView } from "./live-status";
import { fieldPosition, type GameView } from "./slate";

const teams = { home: { abbr: "OSU" }, away: { abbr: "PSU" } };

describe("fieldPosition", () => {
  it("maps a home-side spot toward the right end zone", () => {
    expect(
      fieldPosition({
        status: "in_progress",
        possession: "away",
        situation: "1st & Goal at OSU 4",
        ...teams,
      }),
    ).toEqual({ x: 96, dir: "right" });
  });

  it("maps own-territory possession driving left", () => {
    expect(
      fieldPosition({
        status: "in_progress",
        possession: "home",
        situation: "2nd & 9 at OSU 25",
        ...teams,
      }),
    ).toEqual({ x: 75, dir: "left" });
  });

  it("maps an away-side spot by distance from the left end zone", () => {
    expect(
      fieldPosition({
        status: "in_progress",
        possession: "away",
        situation: "3rd & 2 at PSU 41",
        ...teams,
      }),
    ).toEqual({ x: 41, dir: "right" });
  });

  it("fails closed on an ambiguous side token", () => {
    expect(
      fieldPosition({
        status: "in_progress",
        possession: "away",
        situation: "1st & 10 at XYZ 30",
        ...teams,
      }),
    ).toBeNull();
  });

  it("returns null unless the game is live with known possession", () => {
    expect(
      fieldPosition({ status: "final", possession: "away", situation: "1st & 10 at OSU 30", ...teams }),
    ).toBeNull();
    expect(
      fieldPosition({ status: "in_progress", possession: null, situation: "1st & 10 at OSU 30", ...teams }),
    ).toBeNull();
  });
});

describe("pickCoverView", () => {
  it("grades a comfortable spread cover", () => {
    // home -6.5, up 28-14 → covering by 7½; margin stays quiet on covering
    const v = pickCoverView("home", -6.5, 28, 14)!;
    expect(v.tier).toBe("covering");
    expect(v.word).toBe("Covering");
  });

  it("flags the bubble within a field goal of the number, either side", () => {
    expect(pickCoverView("home", -2.5, 24, 23)!.tier).toBe("bubble"); // −1½
    expect(pickCoverView("home", -2.5, 27, 23)!.tier).toBe("bubble"); // +1½
    expect(pickCoverView("home", -2.5, 30, 23)!.tier).toBe("covering"); // +4½
  });

  it("shows the deficit on a losing cover", () => {
    const v = pickCoverView("away", 3.5, 27, 17)!;
    expect(v.tier).toBe("losing");
    expect(v.margin).toBe("−6½");
  });

  it("treats a clinched over as covering, not bubble", () => {
    const v = pickCoverView("over", 44.5, 28, 21)!;
    expect(v.tier).toBe("covering");
    expect(v.sub).toBe("Over hit");
  });
});

describe("liveUrgency", () => {
  const live = (myPick: GameView["myPick"], homePoints: number, awayPoints: number) =>
    ({ status: "in_progress", myPick, homePoints, awayPoints }) as GameView;

  it("sorts bubble ahead of losing ahead of covering ahead of no pick", () => {
    const bubble = live({ side: "home", line: -2.5 }, 24, 23);
    const losing = live({ side: "home", line: -2.5 }, 14, 24);
    const covering = live({ side: "home", line: -2.5 }, 35, 14);
    const noPick = live(null, 21, 21);
    const order = [noPick, covering, losing, bubble].sort((a, b) => liveUrgency(a) - liveUrgency(b));
    expect(order).toEqual([bubble, losing, covering, noPick]);
  });
});

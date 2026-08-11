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
  it("grades a comfortable spread cover, margin included", () => {
    // home -6.5, up 28-14 → covering by 7½
    const v = pickCoverView("spread", "home", -6.5, 28, 14)!;
    expect(v.tier).toBe("covering");
    expect(v.word).toBe("Covering");
    expect(v.margin).toBe("+7½");
  });

  it("tiers by sign alone — a knife edge is still green or red", () => {
    expect(pickCoverView("spread", "home", -2.5, 24, 23)!.tier).toBe("losing"); // −1½
    expect(pickCoverView("spread", "home", -2.5, 27, 23)!.tier).toBe("covering"); // +1½
    expect(pickCoverView("spread", "home", -2.5, 30, 23)!.tier).toBe("covering"); // +4½
  });

  it("keeps the margin as the closeness read now that amber no longer is", () => {
    const ahead = pickCoverView("spread", "home", -2.5, 27, 23)!; // +1½
    expect(ahead.tier).toBe("covering");
    expect(ahead.word).toBe("Covering");
    expect(ahead.margin).toBe("+1½");

    const behind = pickCoverView("spread", "home", -2.5, 24, 23)!; // −1½
    expect(behind.tier).toBe("losing");
    expect(behind.word).toBe("Not covering");
    expect(behind.margin).toBe("−1½");
  });

  it("calls an exact push 'On the number', amber tier, no margin", () => {
    const v = pickCoverView("spread", "home", -3, 24, 21)!;
    expect(v.tier).toBe("push");
    expect(v.word).toBe("On the number");
    expect(v.margin).toBeNull();
  });

  it("carries no sub-hint on spread picks — 'a FG flips it' restated the colour", () => {
    for (const [pts, opp] of [
      [27, 23],
      [24, 23],
      [24, 21],
      [35, 14],
    ]) {
      expect(pickCoverView("spread", "home", -2.5, pts, opp)!.sub).toBeNull();
    }
  });

  it("reads an away pick's line as home-perspective, like everything else", () => {
    // Stored line +3.5 = home getting 3.5, so the away backer laid 3.5 and
    // leads by ten: covering by 6½. (This branch used to flip the sign for
    // away picks and would have called this a 13½-point deficit.)
    const laid = pickCoverView("spread", "away", 3.5, 17, 27)!;
    expect(laid.tier).toBe("covering");
    expect(laid.margin).toBe("+6½");

    // Stored −6.5 = away getting 6.5; down ten only loses the cover by 3½.
    const got = pickCoverView("spread", "away", -6.5, 27, 17)!;
    expect(got.tier).toBe("losing");
    expect(got.margin).toBe("−3½");
  });

  it("treats a clinched over as covering", () => {
    const v = pickCoverView("total", "over", 44.5, 28, 21)!;
    expect(v.tier).toBe("covering");
    expect(v.sub).toBe("Over hit");
  });
});

describe("liveUrgency", () => {
  const live = (myPicks: GameView["myPicks"], homePoints: number, awayPoints: number) =>
    ({ status: "in_progress", myPicks, myBets: [], homePoints, awayPoints }) as unknown as GameView;

  it("sorts by distance from the number — closest sweat first, no pick last", () => {
    const knifeEdge = live([{ market: "spread", side: "home", line: -2.5 }], 24, 23); // −1½
    const losing = live([{ market: "spread", side: "home", line: -2.5 }], 14, 24); // −12½
    const covering = live([{ market: "spread", side: "home", line: -2.5 }], 35, 14); // +18½
    const noPick = live([], 21, 21);
    const order = [noPick, covering, losing, knifeEdge].sort((a, b) => liveUrgency(a) - liveUrgency(b));
    expect(order).toEqual([knifeEdge, losing, covering, noPick]);
  });

  it("breaks a distance tie in favour of the losing pick", () => {
    const losingBy3 = live([{ market: "spread", side: "home", line: -7 }], 25, 21); // up 4, −3 ATS
    const coveringBy3 = live([{ market: "spread", side: "home", line: -7 }], 31, 21); // up 10, +3 ATS
    expect(liveUrgency(losingBy3)).toBeLessThan(liveUrgency(coveringBy3));
  });

  it("puts an on-the-number game ahead of everything", () => {
    const onNumber = live([{ market: "spread", side: "home", line: -3 }], 24, 21);
    const close = live([{ market: "spread", side: "home", line: -2.5 }], 24, 22); // −½
    expect(liveUrgency(onNumber)).toBeLessThan(liveUrgency(close));
  });

  it("reads a ledger bet's sweat when there is no pick — same priority as the aura", () => {
    const betOnly = {
      status: "in_progress",
      myPicks: [],
      myBets: [{ id: 3, betType: "spread", side: "away", line: -7 }],
      homePoints: 17,
      awayPoints: 10, // on the number exactly: the hardest sweat there is
    } as unknown as GameView;
    const pickCovering = live([{ market: "spread", side: "home", line: -2.5 }], 35, 14);
    expect(liveUrgency(betOnly)).toBeLessThan(liveUrgency(pickCovering));
  });

  it("retires a clinched total from the sweat order", () => {
    const clinched = live([{ market: "total", side: "over", line: 44.5 }], 28, 21);
    const covering = live([{ market: "spread", side: "home", line: -2.5 }], 35, 14);
    expect(liveUrgency(covering)).toBeLessThan(liveUrgency(clinched));
  });
});

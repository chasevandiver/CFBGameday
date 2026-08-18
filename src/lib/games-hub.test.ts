import { describe, expect, it } from "vitest";
import { EMPTY_HUB_STATE, gamesHubRows, type GamesHubState } from "./games-hub";

const state = (over: Partial<GamesHubState> = {}): GamesHubState => ({
  ...EMPTY_HUB_STATE,
  signedIn: true,
  ...over,
});

const row = (s: GamesHubState, id: string) => {
  const found = gamesHubRows(s).find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

describe("gamesHubRows — ordering", () => {
  it("puts anything outstanding first, so the first tap is what you owe", () => {
    const s = state({
      streak: { hasToday: true, pickedToday: true, current: 3, best: 5 },
      gtg: { attempts: 0, solved: false, played: false }, // outstanding
      lines: { open: 0, mine: 4, meanError: 1.2 },
    });
    expect(gamesHubRows(s)[0]!.id).toBe("guess-game");
  });

  it("holds a fixed order when nothing is outstanding", () => {
    const s = state({
      signedIn: false, // nothing can be outstanding for a signed-out viewer
      streak: { hasToday: true, pickedToday: false, current: 0, best: 0 },
    });
    expect(gamesHubRows(s).map((r) => r.id)).toEqual([
      "streak",
      "tape",
      "guess-game",
      "guess-lines",
      "six-pack",
    ]);
  });

  it("never marks anything outstanding for a signed-out viewer", () => {
    const s = state({
      signedIn: false,
      streak: { hasToday: true, pickedToday: false, current: 0, best: 0 },
      lines: { open: 8, mine: 0, meanError: null },
    });
    expect(gamesHubRows(s).some((r) => r.outstanding)).toBe(false);
  });

  it("always returns every game, in every state", () => {
    expect(gamesHubRows(EMPTY_HUB_STATE)).toHaveLength(5);
  });
});

describe("gamesHubRows — the copy", () => {
  it("a dormant streak day reads 'no matchup', not 'unplayed'", () => {
    // The distinction the streak's own page makes: dormancy is a state of the
    // schedule, not a thing the player failed to do.
    const r = row(state({ streak: { hasToday: false, pickedToday: false, current: 4, best: 9 } }), "streak");
    expect(r.state).toBe("No matchup today");
    expect(r.outstanding).toBe(false);
  });

  it("an unplayed live streak day shows the run and asks for a pick", () => {
    const r = row(state({ streak: { hasToday: true, pickedToday: false, current: 4, best: 9 } }), "streak");
    expect(r.state).toBe("4 in a row · best 9");
    expect(r.outstanding).toBe(true);
  });

  it("a picked day says you're in", () => {
    const r = row(state({ streak: { hasToday: true, pickedToday: true, current: 4, best: 9 } }), "streak");
    expect(r.state).toBe("In · 4 in a row");
    expect(r.outstanding).toBe(false);
  });

  it("guess the game distinguishes solved, in progress, and untouched", () => {
    expect(row(state({ gtg: { attempts: 3, solved: true, played: true } }), "guess-game").state).toBe(
      "Solved in 3",
    );
    expect(row(state({ gtg: { attempts: 2, solved: false, played: true } }), "guess-game").state).toBe(
      "2 of 6 used",
    );
    expect(row(state(), "guess-game").state).toBe("Not played");
  });

  it("a busted puzzle is finished, not outstanding", () => {
    const r = row(state({ gtg: { attempts: 6, solved: false, played: true } }), "guess-game");
    expect(r.outstanding).toBe(false);
  });

  it("guess the lines counts what's in against the whole slate", () => {
    const r = row(state({ lines: { open: 5, mine: 3, meanError: 1.44 } }), "guess-lines");
    expect(r.state).toBe("3 of 8 in · off by 1.4 avg");
    expect(r.outstanding).toBe(true);
  });

  it("an ungraded slate omits the average rather than printing a zero", () => {
    const r = row(state({ lines: { open: 8, mine: 0, meanError: null } }), "guess-lines");
    expect(r.state).toBe("0 of 8 in");
  });

  it("no slate reads 'no slate yet' and owes nothing", () => {
    const r = row(state(), "guess-lines");
    expect(r.state).toBe("No slate yet");
    expect(r.outstanding).toBe(false);
  });

  it("the six-pack reads open, entered, and graded", () => {
    expect(row(state({ sixPack: { open: true, entered: false, correct: null } }), "six-pack").state).toBe(
      "Open",
    );
    expect(row(state({ sixPack: { open: true, entered: true, correct: null } }), "six-pack").state).toBe(
      "Entered · locks at kickoff",
    );
    expect(row(state({ sixPack: { open: true, entered: true, correct: 5 } }), "six-pack").state).toBe(
      "5 correct",
    );
  });

  it("every row has non-empty copy in every state", () => {
    for (const s of [EMPTY_HUB_STATE, state(), state({ signedIn: false })]) {
      for (const r of gamesHubRows(s)) {
        expect(r.state.length).toBeGreaterThan(0);
        expect(r.blurb.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("gamesHubRows — The Tape", () => {
  const tapeRow = (over: Partial<GamesHubState["tape"]>, signedIn = true) =>
    gamesHubRows({
      ...EMPTY_HUB_STATE,
      signedIn,
      tape: { hasToday: true, answered: 0, done: false, correct: null, ...over },
    }).find((r) => r.id === "tape")!;

  /**
   * The same distinction the streak row makes, and it matters for the same
   * reason: a day with no round is a state of the WORLD, not of the player, and
   * calling it "not played" blames them for it.
   */
  it("a day with no round reads 'no round', not 'not played'", () => {
    const row = gamesHubRows({ ...EMPTY_HUB_STATE, signedIn: true }).find((r) => r.id === "tape")!;
    expect(row.state).toBe("No round today");
    expect(row.outstanding).toBe(false);
  });

  it("shows progress mid-round", () => {
    expect(tapeRow({ answered: 2 }).state).toBe("2 of 5 answered");
  });

  it("shows the result once the round is done", () => {
    expect(tapeRow({ answered: 5, done: true, correct: 4 }).state).toBe("4 of 5");
  });

  it("is outstanding until the round is finished, not until it is started", () => {
    expect(tapeRow({ answered: 0 }).outstanding).toBe(true);
    expect(tapeRow({ answered: 3 }).outstanding).toBe(true);
    expect(tapeRow({ answered: 5, done: true, correct: 5 }).outstanding).toBe(false);
  });

  it("is never outstanding for a signed-out viewer", () => {
    expect(tapeRow({ answered: 0 }, false).outstanding).toBe(false);
  });
});

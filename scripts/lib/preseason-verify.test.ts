import { describe, expect, it } from "vitest";
import { MIN_BOARD, preseasonVerdict, type PreseasonState } from "./preseason-verify";

/** A board that landed cleanly — the 2026 shape with the fixes in it. */
const GOOD: PreseasonState = {
  seasonId: 2026,
  ratings: 138,
  versions: ["2026.5.0"],
  expectedVersion: "2026.5.0",
  hfaRows: 138,
  distinctBlendedHfa: 1,
  components: 138,
  staleTalentRows: 0,
  halvesMismatched: 0,
  chainBreaks: 0,
  prevBoard: 136,
  finals: 0,
};

const withState = (patch: Partial<PreseasonState>): PreseasonState => ({ ...GOOD, ...patch });

describe("preseasonVerdict", () => {
  it("passes a board that landed", () => {
    expect(preseasonVerdict(GOOD).problems).toEqual([]);
  });

  it("says one thing when nothing loaded, not six", () => {
    // Every other check would also fail here and none would say more.
    const { problems } = preseasonVerdict(withState({ ratings: 0, hfaRows: 0, components: 0 }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("wrote nothing");
  });

  it("catches the failure this exists for: green load, stale version", () => {
    // Aug 22 fires unattended. The upserts succeed, the job goes green, and
    // production is still four versions behind — which is exactly what
    // "Done: N rows loaded" cannot tell you.
    const { problems } = preseasonVerdict(withState({ versions: ["2026.2.0"] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("did not take");
  });

  it("catches a half-loaded board, which is worse than an old one", () => {
    // Half the slate priced by one model and half by another, with nothing on
    // screen saying so.
    expect(preseasonVerdict(withState({ versions: ["2026.2.0", "2026.5.0"] })).problems[0]).toContain(
      "mixed model_version",
    );
  });

  it("catches team_hfa left behind by an older build", () => {
    // 02:M-05 shipped teamHfaBlend 0, so every team prices at the flat baseHfa.
    // The live 2026.2.0 table has 70 distinct values across 138 teams; if that
    // survives a load, the derived table is stale even though the ratings look
    // new. It is the one table that can rot without anything else looking wrong.
    const { problems } = preseasonVerdict(withState({ distinctBlendedHfa: 70 }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("older build");
  });

  it("catches Track B missing from the build that produced the rows", () => {
    // The five 2023-2025 FBS entrants carried final_prev_rating null under
    // 2026.2.0. After the admission fix they must chain from last season.
    const { problems } = preseasonVerdict(withState({ chainBreaks: 5 }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Track B");
  });

  it("accepts talent_stale only as all or nothing", () => {
    // One build-wide decision stamped on every row, so a partial set means two
    // builds' rows are mixed and the /model note is right for some teams only.
    expect(preseasonVerdict(withState({ staleTalentRows: 138 })).problems).toEqual([]);
    expect(preseasonVerdict(withState({ staleTalentRows: 0 })).problems).toEqual([]);
    expect(preseasonVerdict(withState({ staleTalentRows: 42 })).problems[0]).toContain("two builds");
  });

  it("treats the board size as a floor, since FBS membership moves", () => {
    expect(preseasonVerdict(withState({ ratings: MIN_BOARD, hfaRows: MIN_BOARD, components: MIN_BOARD })).problems).toEqual([]);
    expect(
      preseasonVerdict(withState({ ratings: 120, hfaRows: 120, components: 120 })).problems[0],
    ).toContain("full board");
  });

  it("reports every independent problem at once rather than the first", () => {
    // Someone reading a red run at 11am on Aug 22 should get the whole picture
    // in one pass, not fix one thing and rediscover the next.
    const { problems } = preseasonVerdict(
      withState({ versions: ["2026.2.0"], distinctBlendedHfa: 70, chainBreaks: 5 }),
    );
    expect(problems).toHaveLength(3);
  });

  it("flags a season that has already started, without calling it a load failure", () => {
    const { problems } = preseasonVerdict(withState({ finals: 3 }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ratings-update");
  });

  it("catches halves that no longer reconstruct the overall", () => {
    expect(preseasonVerdict(withState({ halvesMismatched: 2 })).problems[0]).toContain(
      "offense + defense",
    );
  });
});

describe("what cannot be checked is said, not silently passed", () => {
  it("reports an unevaluable chain check as a notice rather than a pass", () => {
    // This project has never written a prior-season board, so the set the
    // chain check compares against is empty and it silently passes for every
    // team. That is the --tune-team-hfa Gate 0 defect: an absent measurement
    // reported as evidence of absence.
    const v = preseasonVerdict(withState({ prevBoard: 0 }));
    expect(v.notices).toHaveLength(1);
    expect(v.notices[0]).toContain("CANNOT BE EVALUATED");
  });

  it("does not fail a good load over it", () => {
    // A red run every morning for a condition nobody can fix is how this repo
    // already learned people stop reading them — jobs.yml says so in three
    // places. So: loud, and green.
    expect(preseasonVerdict(withState({ prevBoard: 0 })).problems).toEqual([]);
  });

  it("still fails a bad load that also cannot evaluate the chain", () => {
    // The notice must not swallow a real problem alongside it.
    const v = preseasonVerdict(withState({ prevBoard: 0, versions: ["2026.2.0"] }));
    expect(v.problems).toHaveLength(1);
    expect(v.notices).toHaveLength(1);
  });
});

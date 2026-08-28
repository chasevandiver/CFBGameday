import { describe, expect, it } from "vitest";
import { badgeLabel, openPickCount } from "./picks-due";

describe("openPickCount — what the Groups badge counts", () => {
  it("counts the games with no pick on them", () => {
    expect(
      openPickCount({ boardGameIds: [1, 2, 3], pickedGameIds: [2], lockedGameIds: [] }),
    ).toBe(2);
  });

  it("is silent when the week is done", () => {
    expect(
      openPickCount({ boardGameIds: [1, 2], pickedGameIds: [1, 2], lockedGameIds: [] }),
    ).toBe(0);
  });

  it("does not count a game that has already kicked", () => {
    // make_pick refuses these at the database. Badging them would show a debt
    // the app will not let anyone pay, and a badge that cannot clear is one
    // people stop seeing.
    expect(
      openPickCount({ boardGameIds: [1, 2, 3], pickedGameIds: [], lockedGameIds: [1, 2] }),
    ).toBe(1);
  });

  it("treats one pick on a game as that game handled", () => {
    // A board can ask for a spread AND a total on the same game; requiring
    // both would badge someone who has done everything it asked. Same rule
    // notifyPicksDueJob uses, deliberately.
    expect(
      openPickCount({ boardGameIds: [7], pickedGameIds: [7, 7], lockedGameIds: [] }),
    ).toBe(0);
  });

  it("says nothing when there is no board", () => {
    expect(openPickCount({ boardGameIds: [], pickedGameIds: [], lockedGameIds: [] })).toBe(0);
  });
});

describe("badgeLabel", () => {
  it("renders nothing at zero, which is the common case", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(-1)).toBeNull();
  });

  it("counts up to nine", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
  });

  it("stops counting past nine, where digits stop being information", () => {
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(40)).toBe("9+");
  });
});

/**
 * The reads behind the count must scope to LIVE memberships in LIVE groups.
 * `openPickCount` cannot see the queries, and a mocked client returns whatever
 * it is told — so the guard is on the request source, the groups.test.ts
 * pattern. Without these filters, an archived test group's board counted
 * against its ex-members forever: "26 picks still to make" on a hub with two
 * groups (owner report 2026-08-28). Same rule pinned for the push jobs, which
 * share the definition and had the same defect.
 */
describe("the membership reads behind the count", () => {
  it("the hub count takes live memberships in unarchived groups only", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./picks-due.ts", import.meta.url), "utf8");
    expect(src).toMatch(
      /from\("group_members"\)\s*\n\s*\.select\("group_id, groups!inner\(archived_at\)"\)\s*\n\s*\.eq\("user_id", userId\)\s*\n\s*\.is\("removed_at", null\)\s*\n\s*\.is\("groups\.archived_at", null\)/,
    );
  });

  it("the push jobs nag live members of unarchived groups only", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../scripts/lib/notify-jobs.ts", import.meta.url),
      "utf8",
    );
    // Both jobs' member reads carry the removed filter — every read of
    // group_members must say so within its own chain.
    const memberReads = src.match(/from\("group_members"\)[\s\S]{0,220}/g) ?? [];
    expect(memberReads.length).toBeGreaterThanOrEqual(2);
    for (const read of memberReads) {
      expect(read).toContain('.is("removed_at", null)');
    }
    // …and both jobs' group-week scans exclude archived groups.
    expect(src.match(/\.is\("groups\.archived_at", null\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

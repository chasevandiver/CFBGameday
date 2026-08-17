import { describe, expect, it } from "vitest";
import { EVERYONE, resolveGameScope, scopeLabel, scopeQuery } from "./games-scope";
import type { GroupSummary } from "./groups";

const group = (slug: string, over: Partial<GroupSummary> = {}): GroupSummary => ({
  id: `id-${slug}`,
  name: slug.replace(/-/g, " "),
  slug,
  visibility: "private",
  kind: "pickem",
  picksHiddenUntilKickoff: false,
  leagues: ["cfb"],
  role: "member",
  ...over,
});

const crew = group("sunday-crew");
const work = group("work-pool");

describe("resolveGameScope — precedence", () => {
  it("?g=<slug> you're in wins over everything", () => {
    expect(resolveGameScope([crew, work], "work-pool", "sunday-crew")).toEqual({
      kind: "group",
      group: work,
    });
  });

  it("?g=* is everyone, explicitly", () => {
    expect(resolveGameScope([crew], EVERYONE, "sunday-crew")).toEqual({ kind: "everyone" });
  });

  it("the remembered cookie decides when there is no param", () => {
    expect(resolveGameScope([crew, work], null, "work-pool")).toEqual({
      kind: "group",
      group: work,
    });
    expect(resolveGameScope([crew, work], null, EVERYONE)).toEqual({ kind: "everyone" });
  });

  it("defaults to your only group when you have exactly one", () => {
    // The owner's ask, verbatim: "it just defaults you to your group if it's
    // the only one" — with no cookie and no param.
    expect(resolveGameScope([crew], null, null)).toEqual({ kind: "group", group: crew });
  });

  it("defaults to your first group when you have several", () => {
    expect(resolveGameScope([crew, work], null, null)).toEqual({ kind: "group", group: crew });
  });

  it("is everyone for a viewer in no groups, and for a signed-out one", () => {
    expect(resolveGameScope([], null, null)).toEqual({ kind: "everyone" });
    expect(resolveGameScope([], null, "sunday-crew")).toEqual({ kind: "everyone" });
  });
});

describe("resolveGameScope — falling back rather than failing", () => {
  it("a ?g= naming a group you are not in falls through to your own", () => {
    // A stale shared link must not blank the page; the games are not a
    // private board and your own pool is the better answer than an error.
    expect(resolveGameScope([crew], "someone-elses-pool", null)).toEqual({
      kind: "group",
      group: crew,
    });
  });

  it("a stale cookie (a group you left) falls through too", () => {
    expect(resolveGameScope([crew], null, "a-group-i-left")).toEqual({
      kind: "group",
      group: crew,
    });
  });

  it("a stale ?g= for a viewer with no groups lands on everyone", () => {
    expect(resolveGameScope([], "gone", "also-gone")).toEqual({ kind: "everyone" });
  });
});

describe("scope labels and links", () => {
  it("labels a group by name and everyone by the word", () => {
    expect(scopeLabel({ kind: "group", group: crew })).toBe("sunday crew");
    expect(scopeLabel({ kind: "everyone" })).toBe("everyone");
  });

  it("round-trips through the ?g= param", () => {
    const scope = { kind: "group", group: crew } as const;
    expect(scopeQuery(scope)).toBe("?g=sunday-crew");
    expect(resolveGameScope([crew], "sunday-crew", null)).toEqual(scope);
    expect(scopeQuery({ kind: "everyone" })).toBe(`?g=${encodeURIComponent(EVERYONE)}`);
  });
});

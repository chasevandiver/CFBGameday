import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { joinedLabel } from "./groups";

/**
 * The roster came back empty for five days and nothing failed.
 *
 * `group_members` has two foreign keys to `profiles` — `user_id` (0020) and
 * `removed_by` (0038) — so an unqualified `profiles!inner(…)` embed is
 * ambiguous, and PostgREST answers PGRST201 rather than rows. None of that is
 * visible to a unit test: it is a property of the request string and the live
 * schema, and every mock of a Supabase client will happily return whatever it
 * was told to.
 *
 * So the guard is on the request string itself. It is a blunt test and it is
 * the only kind that could have caught this one.
 */
describe("the roster query", () => {
  const source = readFileSync(new URL("./groups.ts", import.meta.url), "utf8");

  /* Only the request strings, never the prose — this file's own comments name
     the ambiguous form in order to explain it. */
  const selects = [...source.matchAll(/\.select\(\s*"([^"]+)"/g)].map((m) => m[1]);

  it("has a select to check at all", () => {
    expect(selects.length).toBeGreaterThan(0);
  });

  it("names the foreign key when embedding profiles", () => {
    const embeds = selects.filter((q) => q.includes("profiles"));
    expect(embeds.length).toBeGreaterThan(0);
    for (const q of embeds) {
      expect(q).toContain("profiles!group_members_user_id_fkey(");
      expect(q).not.toMatch(/profiles!(inner|left)\(/);
    }
  });

  it("does not swallow the error that reported it", () => {
    // `const { data } = await …` is how a PGRST201 became "0 members".
    expect(source).toMatch(/const \{ data, error \} = await supabase\s*\n\s*\.from\("group_members"\)/);
    expect(source).toContain("if (error) throw new Error(`group roster:");
  });
});

/**
 * The roster's one piece of logic. It exists so a member added a minute ago
 * reads as *just added* rather than as one more name in a list — which is the
 * whole reason the section was built.
 */
describe("joinedLabel", () => {
  const tz = "America/Chicago";
  // 2026-08-18 20:00 UTC = 3pm in Chicago.
  const now = new Date("2026-08-18T20:00:00Z");

  it("says today for someone added today", () => {
    expect(joinedLabel("2026-08-18T14:30:00Z", tz, now)).toBe("joined today");
  });

  it("counts by calendar day, not by elapsed hours", () => {
    // 04:30 UTC on the 18th is 11:30pm on the 17th in Chicago — fifteen hours
    // ago, and yesterday. Hours would have called this today and been wrong to
    // the only person who can check it.
    expect(joinedLabel("2026-08-18T04:30:00Z", tz, now)).toBe("joined yesterday");
  });

  it("and a late-night add on the current day is still today", () => {
    const lateNight = new Date("2026-08-19T04:30:00Z"); // 11:30pm on the 18th CT
    expect(joinedLabel("2026-08-19T02:00:00Z", tz, lateNight)).toBe("joined today");
  });

  it("falls back to a date once it stops being recent", () => {
    expect(joinedLabel("2026-08-12T16:00:00Z", tz, now)).toBe("joined Aug 12");
  });

  it("dates an old membership in the group's timezone, not the server's", () => {
    // 01:00 UTC on Aug 12 is still Aug 11 in Chicago.
    expect(joinedLabel("2026-08-12T01:00:00Z", tz, now)).toBe("joined Aug 11");
  });
});

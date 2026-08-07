import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { APPEND_ONLY, planLoad, seasonHasStarted, tableOf } from "./load-preseason";

// The filenames build-preseason.ts actually emits, in emit order. If the build
// gains a table this list should gain one too — the point of the test is that
// the loader derives order from the prefix rather than a hard-coded list.
const EMITTED = [
  "01-seasons-0.json",
  "02-teams-0.json",
  "03-venues-0.json",
  "04-games-0.json",
  "05-line_snapshots-0.json",
  "06-team_hfa-0.json",
  "07-ratings-0.json",
  "08-preseason_components-0.json",
  "09-predictions-0.json",
];

describe("tableOf", () => {
  it("pulls the table out of the emitted filename", () => {
    expect(tableOf("06-team_hfa-0.json")).toBe("team_hfa");
    expect(tableOf("/tmp/preseason/02-teams-3.json")).toBe("teams");
  });

  it("returns null for anything the build did not emit", () => {
    // A stray file in the output dir must not be interpreted as a table name
    // and upserted somewhere.
    expect(tableOf("notes.json")).toBeNull();
    expect(tableOf("teams.json")).toBeNull();
    expect(tableOf("01-teams-0.txt")).toBeNull();
  });
});

describe("planLoad", () => {
  it("loads in foreign-key order even when readdir returns shuffled", () => {
    // readdir order is not guaranteed; ratings references seasons and teams, so
    // getting this backwards is an FK violation, not a cosmetic problem.
    const shuffled = [...EMITTED].reverse();
    const order = planLoad(shuffled, true).map((p) => p.table);
    expect(order).toEqual([
      "seasons",
      "teams",
      "venues",
      "games",
      "line_snapshots",
      "team_hfa",
      "ratings",
      "preseason_components",
      "predictions",
    ]);
  });

  it("orders on the counter as a number, not as a string", () => {
    // build-preseason pads the counter to two digits, so a 100+ file build
    // would sort "100" before "99" under a plain lexical sort and load a child
    // table ahead of its parent. games and line_snapshots already emit four
    // files each at CHUNK=250.
    const many = [
      "100-predictions-0.json",
      "99-preseason_components-0.json",
      "9-games-0.json",
      "02-teams-0.json",
    ];
    expect(planLoad(many, true).map((p) => p.table)).toEqual([
      "teams",
      "games",
      "preseason_components",
      "predictions",
    ]);
  });

  it("orders a table's own chunks consistently", () => {
    const chunks = ["04-games-1.json", "04-games-0.json", "04-games-2.json"];
    expect(planLoad(chunks, true).map((p) => p.file)).toEqual([
      "04-games-0.json",
      "04-games-1.json",
      "04-games-2.json",
    ]);
  });

  it("skips append-only tables on a refresh", () => {
    const plan = planLoad(EMITTED, false);
    const skipped = plan.filter((p) => p.skipped).map((p) => p.table);
    expect(skipped).toEqual(["line_snapshots", "predictions"]);
    // ...and everything else still loads
    expect(plan.filter((p) => !p.skipped)).toHaveLength(EMITTED.length - 2);
  });

  it("loads append-only tables under --bootstrap", () => {
    expect(planLoad(EMITTED, true).every((p) => p.skipped === null)).toBe(true);
  });

  it("keeps the skip list in step with the identity-PK tables", () => {
    // Guard against someone adding an identity-PK table to the build and not
    // here: these two are the only ones in 0001_core_schema.sql that the
    // preseason build emits.
    expect([...APPEND_ONLY].sort()).toEqual(["line_snapshots", "predictions"]);
  });

  it("ignores non-JSON files in the output directory", () => {
    expect(planLoad([...EMITTED, "README.md", ".DS_Store"], true)).toHaveLength(EMITTED.length);
  });
});

/** Minimal stub of the PostgREST builder chain seasonHasStarted walks. */
const stubDb = (result: { data?: unknown[]; error?: { message: string } }) => {
  const filters: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return chain;
    },
    limit: () => Promise.resolve(result),
  };
  return { db: { from: () => chain } as unknown as SupabaseClient, filters };
};

describe("seasonHasStarted", () => {
  it("is true once any game is final", async () => {
    const { db } = stubDb({ data: [{ id: 1 }] });
    expect(await seasonHasStarted(db, 2026)).toBe(true);
  });

  it("is false while every game is still scheduled", async () => {
    const { db } = stubDb({ data: [] });
    expect(await seasonHasStarted(db, 2026)).toBe(false);
  });

  it("filters on the season and on final status, not on games in general", async () => {
    // Without the status filter this returns true the moment a schedule is
    // ingested, which would block every preseason load.
    const { db, filters } = stubDb({ data: [] });
    await seasonHasStarted(db, 2026);
    expect(filters).toEqual({ season_id: 2026, status: "final" });
  });

  it("throws rather than reporting 'not started' when the query fails", async () => {
    // Swallowing the error here would turn a transient outage into permission
    // to overwrite a live season.
    const { db } = stubDb({ error: { message: "boom" } });
    await expect(seasonHasStarted(db, 2026)).rejects.toThrow("season start check: boom");
  });
});

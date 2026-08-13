import { describe, expect, it } from "vitest";
import { required, requiredOne } from "./db-result";

describe("required", () => {
  it("throws on a failed read, naming it", () => {
    // The whole point: before this, `const { data } = await supabase…` dropped
    // the error and a dead database rendered as an empty season.
    expect(() => required({ data: null, error: { message: "boom" } }, "teams")).toThrowError(
      /teams failed to load: boom/,
    );
  });

  it("does NOT throw on an empty result", () => {
    // Empty is a real state here — /ratings before preseason-refresh has run,
    // /receipts before the first freeze. Those have house empty states and must
    // keep reaching them.
    expect(required<number>({ data: [], error: null }, "ratings")).toEqual([]);
  });

  it("treats a missing error field as success", () => {
    // Call sites short-circuit pointless queries with `{ data: [] }`; that is a
    // deliberate skip, not a read that failed.
    expect(required<number>({ data: [] }, "picks")).toEqual([]);
  });

  it("passes rows through unchanged", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(required({ data: rows, error: null }, "games")).toBe(rows);
  });

  it("throws even when data is also present", () => {
    // PostgREST can return a partial body alongside an error; the error wins,
    // because half a slate presented as a whole one is the failure mode.
    expect(() =>
      required({ data: [{ id: 1 }], error: { message: "partial" } }, "games"),
    ).toThrowError(/games failed to load/);
  });
});

describe("requiredOne", () => {
  it("throws on error", () => {
    expect(() => requiredOne({ data: null, error: { message: "nope" } }, "season")).toThrowError(
      /season failed to load: nope/,
    );
  });

  it("returns null for a row that genuinely is not there", () => {
    // maybeSingle()'s legitimate answer. Not an error.
    expect(requiredOne({ data: null, error: null }, "profile")).toBeNull();
  });

  it("returns the row", () => {
    expect(requiredOne({ data: { id: 7 }, error: null }, "profile")).toEqual({ id: 7 });
  });
});

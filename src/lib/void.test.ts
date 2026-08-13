import { describe, expect, it } from "vitest";
import { isDeadStatus, nextGameStatus, partitionAdminGames } from "./void";

describe("isDeadStatus", () => {
  it("recognises the two dead statuses", () => {
    expect(isDeadStatus("postponed")).toBe(true);
    expect(isDeadStatus("canceled")).toBe(true);
  });

  it("is false for the live ones", () => {
    expect(isDeadStatus("scheduled")).toBe(false);
    expect(isDeadStatus("in_progress")).toBe(false);
    expect(isDeadStatus("final")).toBe(false);
  });

  it("fails closed on anything it does not recognise", () => {
    // A status nobody recognises is not a reason to void somebody's picks.
    // Note the spelling: the codebase uses one L throughout, so the British
    // form must NOT read as dead by accident.
    expect(isDeadStatus("cancelled")).toBe(false);
    expect(isDeadStatus("")).toBe(false);
    expect(isDeadStatus(null)).toBe(false);
    expect(isDeadStatus(undefined)).toBe(false);
  });
});

describe("nextGameStatus", () => {
  it("voids a scheduled game either way", () => {
    expect(nextGameStatus("scheduled", "postpone")).toEqual({ ok: true, status: "postponed" });
    expect(nextGameStatus("scheduled", "cancel")).toEqual({ ok: true, status: "canceled" });
  });

  it("refuses to void a final game", () => {
    // Grading has already written results, CLV and units against it.
    expect(nextGameStatus("final", "postpone")).toMatchObject({ ok: false });
    expect(nextGameStatus("final", "cancel")).toMatchObject({ ok: false });
    expect(nextGameStatus("final", "postpone")).toMatchObject({ reason: /final/ });
  });

  it("refuses to postpone a live game, but allows cancelling one", () => {
    // The scoreboard loop rewrites `in_progress` every 30s, so a postponement
    // set mid-game is undone within a tick while its voids persist.
    // Abandonment is real, rarer, and `canceled` is the honest word.
    expect(nextGameStatus("in_progress", "postpone")).toMatchObject({ ok: false });
    expect(nextGameStatus("in_progress", "cancel")).toEqual({ ok: true, status: "canceled" });
  });

  it("restores a dead game to scheduled, never to final", () => {
    expect(nextGameStatus("postponed", "restore")).toEqual({ ok: true, status: "scheduled" });
    expect(nextGameStatus("canceled", "restore")).toEqual({ ok: true, status: "scheduled" });
  });

  it("refuses a restore that would do nothing", () => {
    expect(nextGameStatus("scheduled", "restore")).toMatchObject({ ok: false });
    expect(nextGameStatus("final", "restore")).toMatchObject({ ok: false });
  });

  it("refuses a no-op void so the action cannot report success for nothing", () => {
    expect(nextGameStatus("postponed", "postpone")).toMatchObject({ ok: false });
    expect(nextGameStatus("canceled", "cancel")).toMatchObject({ ok: false });
  });

  it("allows switching between the two dead statuses", () => {
    // Postponed then abandoned is a real sequence; it voids nothing new
    // because the first write already did.
    expect(nextGameStatus("postponed", "cancel")).toEqual({ ok: true, status: "canceled" });
    expect(nextGameStatus("canceled", "postpone")).toEqual({ ok: true, status: "postponed" });
  });

  it("refuses an unrecognised current status rather than defaulting", () => {
    expect(nextGameStatus("cancelled", "restore")).toMatchObject({ ok: false });
    expect(nextGameStatus("", "postpone")).toMatchObject({ ok: false });
    expect(nextGameStatus("weather_delay", "postpone")).toMatchObject({ reason: /Unrecognised/ });
  });
});

describe("partitionAdminGames", () => {
  const g = (id: number, status: string, start_ts: string | null) => ({ id, status, start_ts });

  it("splits open from dead and drops finals", () => {
    const { open, dead } = partitionAdminGames([
      g(1, "scheduled", "2026-08-29T16:00:00Z"),
      g(2, "final", "2026-08-22T16:00:00Z"),
      g(3, "postponed", "2026-08-29T20:00:00Z"),
      g(4, "in_progress", "2026-08-29T12:00:00Z"),
      g(5, "canceled", "2026-08-28T20:00:00Z"),
    ]);
    expect(open.map((x) => x.id)).toEqual([4, 1]);
    expect(dead.map((x) => x.id)).toEqual([5, 3]);
  });

  it("sorts a TBD kickoff last instead of throwing", () => {
    const { open } = partitionAdminGames([
      g(1, "scheduled", null),
      g(2, "scheduled", "2026-08-29T16:00:00Z"),
    ]);
    expect(open.map((x) => x.id)).toEqual([2, 1]);
  });

  it("returns empty lists for an empty slate", () => {
    expect(partitionAdminGames([])).toEqual({ open: [], dead: [] });
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WeekRecords, type WeekRecordRow } from "./WeekRecords";
import { sliceRecord, weekBuckets, type WeekWager } from "../lib/week-records";
import { nflSeasonId } from "../lib/league";

afterEach(cleanup);

const CT = "America/Chicago";
const CFB = 2026;
const NFL = nflSeasonId(2026);

const bet = (
  startTs: string | null,
  seasonId: number,
  result: WeekWager["result"],
  week: number | null = 3,
  extra: Partial<WeekWager> = {},
): WeekWager => ({
  seasonId,
  startTs,
  week,
  seasonType: "regular",
  result,
  units: 1,
  payoutUnits: null,
  odds: -110,
  ...extra,
});

/** A bet on a game being played, currently ahead. */
const live = (startTs: string, seasonId: number, week = 3, standing: "win" | "loss" = "win") =>
  bet(startTs, seasonId, null, week, { standingState: "in_progress", standing });

/** The page's own composition, so the test exercises what the ledger renders. */
function rows(bets: WeekWager[]): WeekRecordRow[] {
  return weekBuckets(bets, CT).map((wk) => ({
    key: wk.key,
    label: wk.label,
    range: wk.range,
    record: sliceRecord(wk.wagers),
    days: wk.days.map((d) => ({
      key: d.key,
      label: d.label,
      record: sliceRecord(d.wagers),
    })),
  }));
}

/**
 * WEEK-1. The owner asked for three numbers on every week — the total, CFB and
 * NFL — and a way to open a week onto its days. WEEK-3 added the fourth claim:
 * those numbers move while the games are on.
 */
describe("WeekRecords", () => {
  const mixed = [
    bet("2026-09-12T16:00:00Z", CFB, "win"),
    bet("2026-09-12T23:00:00Z", CFB, "loss"),
    bet("2026-09-13T17:00:00Z", NFL, "win", 2),
    bet("2026-09-15T00:15:00Z", NFL, "win", 2),
  ];

  it("names a week carrying both leagues by both their numbers, with its dates", () => {
    render(<WeekRecords weeks={rows(mixed)} />);
    expect(screen.getByText("CFB Wk 3 · NFL Wk 2")).toBeTruthy();
    expect(screen.getByText("Sep 12–14")).toBeTruthy();
  });

  it("puts the total record and both leagues' records on the week", () => {
    const { container } = render(<WeekRecords weeks={rows(mixed)} />);
    const summary = container.querySelector("summary") as HTMLElement;
    expect(within(summary).getByText("3-1")).toBeTruthy();
    expect(summary.textContent).toContain("CFB 1-1");
    expect(summary.textContent).toContain("NFL 2-0");
  });

  it("drops the league caption when it would only repeat the total", () => {
    const { container } = render(
      <WeekRecords weeks={rows([bet("2026-09-12T16:00:00Z", CFB, "win")])} />,
    );
    const summary = container.querySelector("summary") as HTMLElement;
    // One league graded, so its record IS the total. The week's own name
    // ("Week 3", not "NFL Week 3") is what says which league it was.
    expect(summary.textContent).toContain("Week 3");
    expect(summary.textContent).not.toContain("CFB");
    expect(summary.textContent).not.toContain("NFL");
  });

  it("opens onto one row per day the week had a bet on, in playing order", () => {
    const { container } = render(<WeekRecords weeks={rows(mixed)} />);
    const days = [...container.querySelectorAll("details > ul > li")].map(
      (li) => li.querySelector("span.block")?.textContent,
    );
    expect(days).toEqual(["Sat", "Sun", "Mon"]);
  });

  it("renders nothing at all when there is no week to show", () => {
    const { container } = render(<WeekRecords weeks={[]} note="ignored" />);
    expect(container.innerHTML).toBe("");
  });

  it("prints the note, because what the weeks leave out has to be said", () => {
    render(<WeekRecords weeks={rows(mixed)} note="1 bet sits in no week." />);
    expect(screen.getByText("1 bet sits in no week.")).toBeTruthy();
  });

  /* ── WEEK-3: live ───────────────────────────────────────────────────── */

  it("counts a game in progress into the record it leads with", () => {
    const { container } = render(
      <WeekRecords weeks={rows([bet("2026-09-12T16:00:00Z", CFB, "win"), live("2026-09-12T20:00:00Z", CFB)])} />,
    );
    const summary = container.querySelector("summary") as HTMLElement;
    expect(within(summary).getByText("2-0")).toBeTruthy();
    expect(summary.textContent).toContain("1 live");
    // and the settled truth is still on the row, labelled
    expect(summary.textContent).toContain("1-0 settled");
  });

  it("marks a live week with the dot, and leaves a finished one unmarked", () => {
    const { container } = render(
      <WeekRecords weeks={rows([live("2026-09-12T20:00:00Z", CFB)])} />,
    );
    expect(container.querySelectorAll(".live-dot").length).toBeGreaterThan(0);
    cleanup();
    const settled = render(<WeekRecords weeks={rows(mixed)} />);
    expect(settled.container.querySelectorAll(".live-dot")).toHaveLength(0);
  });

  it("opens a week with games on it, and leaves a settled one closed", () => {
    const { container } = render(
      <WeekRecords weeks={rows([live("2026-09-12T20:00:00Z", CFB), ...mixed])} />,
    );
    const open = [...container.querySelectorAll("li > details")].map((d) =>
      (d as HTMLDetailsElement).open,
    );
    expect(open).toEqual([true]);
  });

  it("names a final the grader has not reached without calling it live", () => {
    const ungraded = bet("2026-09-12T16:00:00Z", CFB, null, 3, {
      standingState: "final",
      standing: "win",
    });
    const { container } = render(<WeekRecords weeks={rows([ungraded])} />);
    const summary = container.querySelector("summary") as HTMLElement;
    expect(within(summary).getByText("1-0")).toBeTruthy();
    expect(summary.textContent).toContain("1 not graded");
    expect(summary.textContent).not.toContain("live");
    expect(container.querySelectorAll(".live-dot")).toHaveLength(0);
  });

  it("says what is still to come rather than dashing a week nothing has started in", () => {
    render(<WeekRecords weeks={rows([bet("2026-09-12T16:00:00Z", CFB, null)])} />);
    expect(screen.getAllByText("1 to come").length).toBeGreaterThan(0);
  });

  it("breaks the live record down by day too", () => {
    const { container } = render(
      <WeekRecords
        weeks={rows([
          bet("2026-09-12T16:00:00Z", CFB, "win"),
          live("2026-09-13T17:00:00Z", NFL, 2, "loss"),
        ])}
      />,
    );
    const days = [...container.querySelectorAll("details > ul > li")];
    expect(days[0].textContent).toContain("Sat");
    expect(days[0].textContent).toContain("1-0");
    expect(days[1].textContent).toContain("Sun");
    expect(days[1].textContent).toContain("0-1");
    expect(days[1].textContent).toContain("1 live");
  });
});

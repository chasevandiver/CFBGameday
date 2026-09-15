// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WeekRecords, type WeekRecordRow } from "./WeekRecords";
import { leagueSplit, pendingCount, weekBuckets, type WeekWager } from "../lib/week-records";
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
): WeekWager => ({
  seasonId,
  startTs,
  week,
  seasonType: "regular",
  result,
  units: 1,
  payoutUnits: null,
});

/** The page's own composition, so the test exercises what the ledger renders. */
function rows(bets: WeekWager[]): WeekRecordRow[] {
  return weekBuckets(bets, CT).map((wk) => ({
    key: wk.key,
    label: wk.label,
    range: wk.range,
    split: leagueSplit(wk.wagers),
    pending: pendingCount(wk.wagers),
    days: wk.days.map((d) => ({
      key: d.key,
      label: d.label,
      split: leagueSplit(d.wagers),
      pending: pendingCount(d.wagers),
    })),
  }));
}

/**
 * WEEK-1. The owner asked for three numbers on every week — the total, CFB and
 * NFL — and a way to open a week onto its days. These are those four claims.
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

  it("still leaves a league out once the other has graded on its own", () => {
    const { container } = render(
      <WeekRecords
        weeks={rows([
          bet("2026-09-12T16:00:00Z", CFB, "win"),
          bet("2026-09-13T17:00:00Z", NFL, null, 2),
        ])}
      />,
    );
    const summary = container.querySelector("summary") as HTMLElement;
    expect(summary.textContent).not.toContain("NFL 0-0");
    expect(summary.textContent).toContain("1-0");
  });

  it("opens onto one row per day the week had a bet on, in playing order", () => {
    const { container } = render(<WeekRecords weeks={rows(mixed)} />);
    const days = [...container.querySelectorAll("details > ul > li")].map(
      (li) => li.querySelector("span.block")?.textContent,
    );
    expect(days).toEqual(["Sat", "Sun", "Mon"]);
  });

  it("says how many are still out instead of dashing a week nothing has graded in", () => {
    render(<WeekRecords weeks={rows([bet("2026-09-12T16:00:00Z", CFB, null)])} />);
    expect(screen.getAllByText("1 open").length).toBeGreaterThan(0);
  });

  it("renders nothing at all when there is no week to show", () => {
    const { container } = render(<WeekRecords weeks={[]} note="ignored" />);
    expect(container.innerHTML).toBe("");
  });

  it("prints the note, because what the weeks leave out has to be said", () => {
    render(<WeekRecords weeks={rows(mixed)} note="1 bet sits in no week." />);
    expect(screen.getByText("1 bet sits in no week.")).toBeTruthy();
  });
});

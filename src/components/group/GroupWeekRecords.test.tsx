// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GroupWeekRecords, type GroupWeekRow } from "./GroupWeekRecords";
import {
  leagueSplit,
  memberSplits,
  pendingCount,
  weekBuckets,
  type WeekWager,
} from "../../lib/week-records";
import { nflSeasonId } from "../../lib/league";

afterEach(cleanup);

const CT = "America/Chicago";
const CFB = 2026;
const NFL = nflSeasonId(2026);

type Row = WeekWager & { userId: string };

const bet = (
  userId: string,
  startTs: string,
  seasonId: number,
  result: WeekWager["result"],
  units = 1,
  week = 3,
): Row => ({
  userId,
  seasonId,
  startTs,
  week,
  seasonType: "regular",
  result,
  units,
  payoutUnits: null,
});

const NAMES = new Map([
  ["u-jeff", "Jeff Ward"],
  ["u-hayden", "Hayden Cole"],
]);

/** The page's own composition, so the test renders what a group home renders. */
function rows(bets: Row[]): GroupWeekRow[] {
  return weekBuckets(bets, CT).map((wk) => ({
    key: wk.key,
    label: wk.label,
    range: wk.range,
    split: leagueSplit(wk.wagers),
    pending: pendingCount(wk.wagers),
    members: memberSplits(wk.wagers, NAMES),
    days: wk.days.map((d) => ({
      key: d.key,
      label: d.label,
      split: leagueSplit(d.wagers),
      pending: pendingCount(d.wagers),
      members: memberSplits(d.wagers, NAMES),
    })),
  }));
}

/**
 * WEEK-1 on a betting group: the same three cuts, but "the record" is every
 * member's, so a week has to rank them and a day has to re-rank them.
 */
describe("GroupWeekRecords", () => {
  const week = [
    bet("u-jeff", "2026-09-12T16:00:00Z", CFB, "win", 2),
    bet("u-jeff", "2026-09-13T17:00:00Z", NFL, "loss", 1, 2),
    bet("u-hayden", "2026-09-12T16:00:00Z", CFB, "loss", 3),
    bet("u-hayden", "2026-09-13T17:00:00Z", NFL, "loss", 1, 2),
  ];

  it("leads the collapsed week with whoever is up on it", () => {
    const { container } = render(<GroupWeekRecords weeks={rows(week)} slug="crew" />);
    const summary = container.querySelector("summary") as HTMLElement;
    expect(summary.textContent).toContain("Jeff");
    expect(summary.textContent).not.toContain("Hayden");
  });

  it("ranks the members by units and links each to their page", () => {
    render(<GroupWeekRecords weeks={rows(week)} slug="crew" />);
    const names = screen.getAllByRole("link").map((a) => a.textContent);
    expect(names.slice(0, 2)).toEqual(["Jeff Ward", "Hayden Cole"]);
    expect(screen.getAllByRole("link", { name: "Jeff Ward" })[0].getAttribute("href")).toBe(
      "/groups/crew/member/u-jeff",
    );
  });

  it("gives each member their CFB and NFL records beside the total", () => {
    const { container } = render(<GroupWeekRecords weeks={rows(week)} slug="crew" />);
    const jeff = container.querySelector("details > div > ul > li") as HTMLElement;
    expect(jeff.textContent).toContain("CFB 1-0");
    expect(jeff.textContent).toContain("NFL 0-1");
    expect(jeff.textContent).toContain("1-1");
  });

  it("offers the day fold, and re-ranks the roster inside each day", () => {
    render(<GroupWeekRecords weeks={rows(week)} slug="crew" />);
    expect(screen.getByText("By day")).toBeTruthy();
    expect(screen.getByText("Sat")).toBeTruthy();
    expect(screen.getByText("Sun")).toBeTruthy();
    // Saturday: Jeff won 2u, Hayden lost 3u. Sunday both lost, so the
    // tie breaks on name and Hayden leads — proof the day is its own ranking.
    const days = screen.getAllByText(/Ward|Cole/).map((n) => n.textContent);
    expect(days).toEqual([
      "Jeff Ward",
      "Hayden Cole",
      "Jeff Ward",
      "Hayden Cole",
      "Hayden Cole",
      "Jeff Ward",
    ]);
  });

  it("skips the day fold on a week that was only ever one day", () => {
    render(<GroupWeekRecords weeks={rows([week[0], week[2]])} slug="crew" />);
    expect(screen.queryByText("By day")).toBeNull();
  });

  it("renders plain names with no group to link into", () => {
    render(<GroupWeekRecords weeks={rows(week)} slug={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getAllByText("Jeff Ward").length).toBeGreaterThan(0);
  });

  it("renders nothing when the group has no week on the book yet", () => {
    const { container } = render(<GroupWeekRecords weeks={[]} slug="crew" />);
    expect(container.innerHTML).toBe("");
  });
});

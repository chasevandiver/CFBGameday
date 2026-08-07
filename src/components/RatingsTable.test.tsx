// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { splitInformative } from "../model/ratings";
import { RatingsTable, type RatingRow } from "./RatingsTable";

afterEach(cleanup);

const row = (over: Partial<RatingRow> = {}): RatingRow => ({
  teamId: 1,
  school: "Alabama",
  abbreviation: "ALA",
  conference: "SEC",
  color: null,
  logoUrl: null,
  overall: 21,
  offense: 12,
  defense: 9,
  delta: null,
  churn: null,
  luck: null,
  pollRank: null,
  poll: null,
  ...over,
});

const headers = () =>
  screen.getAllByRole("columnheader").map((th) => th.textContent?.replace(/[↓↑]/g, "").trim());

describe("Off/Def columns", () => {
  it("render when the halves carry information", () => {
    render(<RatingsTable rows={[row()]} showSplit />);
    expect(headers()).toEqual(["#", "Team", "Rating", "Off", "Def", "Δwk", "Churn", "Luck"]);
  });

  it("are hidden when they are not", () => {
    // Audit #11: the columns were pulled entirely because the pipeline wrote
    // overall/2 twice. Hiding is the honest state, not a degraded one.
    render(<RatingsTable rows={[row()]} />);
    expect(headers()).toEqual(["#", "Team", "Rating", "Δwk", "Churn", "Luck"]);
  });

  it("defaults to hidden, so a caller that forgets the gate shows less, not fiction", () => {
    render(<RatingsTable rows={[row()]} />);
    expect(screen.queryByRole("columnheader", { name: /Off/ })).toBeNull();
  });

  it("keeps cells aligned with headers in both modes", () => {
    // The cells are positional, so a header added without its cell silently
    // shifts every number one column left.
    const { unmount } = render(<RatingsTable rows={[row()]} showSplit />);
    let cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells).toHaveLength(8);
    expect(cells[2].textContent).toBe("21.0");
    expect(cells[3].textContent).toBe("+12.0");
    expect(cells[4].textContent).toBe("+9.0");
    unmount();

    render(<RatingsTable rows={[row()]} />);
    cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells).toHaveLength(6);
    expect(cells[2].textContent).toBe("21.0");
  });

  it("signs the sub-ratings — they are deviations, not totals", () => {
    render(<RatingsTable rows={[row({ offense: 12, defense: -3, overall: 9 })]} showSplit />);
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[3].textContent).toBe("+12.0");
    expect(cells[4].textContent).toBe("-3.0");
    // Rating is an absolute position, not a deviation, so it stays unsigned.
    expect(cells[2].textContent).toBe("9.0");
  });

  it("sorts by defense independently of overall", () => {
    const rows = [
      row({ teamId: 1, school: "Alabama", overall: 21, offense: 18, defense: 3 }),
      row({ teamId: 2, school: "Georgia", overall: 20, offense: 4, defense: 16 }),
    ];
    render(<RatingsTable rows={rows} showSplit />);
    fireEvent.click(screen.getByRole("button", { name: /Def/ }));
    const body = screen.getAllByRole("row").slice(1);
    expect(body[0].textContent).toContain("Georgia");
    // Rank stays keyed to overall even when the sort doesn't — Georgia sorts
    // first on defense while still being the #2 team.
    expect(within(body[0]).getAllByRole("cell")[0].textContent).toBe("2");
  });
});

describe("the gate the page applies", () => {
  it("agrees with splitInformative on an even split", () => {
    // The page computes showSplit from the same function that decides whether
    // a projected total is a prediction or a constant.
    expect(splitInformative([{ offense: 10.5, defense: 10.5 }])).toBe(false);
    expect(splitInformative([{ offense: 12, defense: 9 }])).toBe(true);
  });

  it("is true if ANY team has differentiated, not all of them", () => {
    expect(
      splitInformative([
        { offense: 10.5, defense: 10.5 },
        { offense: 12, defense: 9 },
      ]),
    ).toBe(true);
  });
});

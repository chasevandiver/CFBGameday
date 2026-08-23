// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SourceCard } from "./BettingHub";
import { EMPTY_TALLY } from "../../lib/records";
import type { SheetMember } from "../../lib/betting-groups";
import type { PairStats } from "../../lib/tailing";

afterEach(cleanup);

const tally = (wins: number, losses: number, units: number) => ({
  ...EMPTY_TALLY,
  wins,
  losses,
  decided: wins + losses,
  units,
});

const member = (name: string): SheetMember =>
  ({
    userId: `u-${name}`,
    name,
    stats: {
      overall: tally(8, 9, -1),
      originated: tally(8, 9, -1),
      tailedByOthers: tally(0, 0, 0),
      fadedByOthers: tally(0, 1, -1),
      timesFollowed: 1,
    },
    leagueSplit: { cfb: tally(8, 9, -1), nfl: EMPTY_TALLY },
    form: { results: [], label: "level" as const },
  }) as unknown as SheetMember;

const pair = (over: Partial<PairStats> = {}): PairStats => ({
  otherId: "u-Hayden",
  tailing: tally(2, 1, 0.9),
  fading: tally(0, 1, -1),
  ...over,
});

/**
 * GRP-7. Owner request: "click on another user's record and see what their
 * stats are… and what my record is tailing or fading him. That's the social
 * fun of it." The group-wide trio (They open / Tailing them / Fading them)
 * already existed; this is the VIEWER's own cut, which is a different number
 * and the one that starts an argument.
 */
describe("SourceCard opens onto the viewer's record against that member", () => {
  it("expands another member's row and shows YOUR tail/fade record", () => {
    const { container } = render(
      <ul>
        <SourceCard slug="test-crew" place={1} member={member("Hayden")} isMe={false} pair={pair()} />
      </ul>,
    );
    expect(container.querySelector("details")).toBeTruthy();
    expect(screen.getByText("You tailing them")).toBeDefined();
    expect(screen.getByText("You fading them")).toBeDefined();
    expect(screen.getByText("2-1")).toBeDefined();
  });

  it("still expands when you have never followed them — dashes are an answer", () => {
    // An expando that sometimes opens onto nothing teaches people to stop
    // tapping. The caller synthesizes an empty pair for exactly this case.
    const { container } = render(
      <ul>
        <SourceCard slug="test-crew"
          place={2}
          member={member("Hayden")}
          isMe={false}
          pair={pair({ tailing: EMPTY_TALLY, fading: EMPTY_TALLY })}
        />
      </ul>,
    );
    expect(container.querySelector("details")).toBeTruthy();
    expect(screen.getByText("You tailing them")).toBeDefined();
  });

  it("renders your own row as a plain card — you cannot tail yourself", () => {
    const { container } = render(
      <ul>
        <SourceCard slug="test-crew" place={1} member={member("me")} isMe pair={null} />
      </ul>,
    );
    expect(container.querySelector("details")).toBeNull();
  });

  it("renders a plain card signed out, where there is no history to show", () => {
    const { container } = render(
      <ul>
        <SourceCard slug="test-crew" place={1} member={member("Hayden")} isMe={false} pair={null} />
      </ul>,
    );
    expect(container.querySelector("details")).toBeNull();
  });

  it("keeps the group-wide trio distinct from the personal cut", () => {
    // Both render on an expandable, followed member: the trio in the card body,
    // the personal pair behind the fold. Same words would be a lie — they are
    // different denominators.
    render(
      <ul>
        <SourceCard slug="test-crew" place={1} member={member("Hayden")} isMe={false} pair={pair()} />
      </ul>,
    );
    expect(screen.getByText("Tailing them")).toBeDefined();
    expect(screen.getByText("You tailing them")).toBeDefined();
  });
});

/**
 * GRP-8. Owner, after GRP-7 shipped: "I want to be able to click on their name
 * and see other users full stats and bet history. Not just tail/fade." A
 * season of bets is a list, and a list belongs on a page, not in an accordion
 * — so the name is the door, and the expando keeps the quick answer with a
 * "full stats" link at the bottom.
 */
describe("a member's name is the door to their full page", () => {
  it("links another member's name to /groups/<slug>/member/<id>", () => {
    render(
      <ul>
        <SourceCard place={1} slug="test-crew" member={member("Hayden")} isMe={false} pair={pair()} />
      </ul>,
    );
    const link = screen.getByRole("link", { name: "Hayden" });
    expect(link.getAttribute("href")).toBe("/groups/test-crew/member/u-Hayden");
  });

  it("offers the full page from inside the expando too", () => {
    render(
      <ul>
        <SourceCard place={1} slug="test-crew" member={member("Hayden")} isMe={false} pair={pair()} />
      </ul>,
    );
    const link = screen.getByRole("link", { name: /full stats/i });
    expect(link.getAttribute("href")).toBe("/groups/test-crew/member/u-Hayden");
  });

  it("does not link your own name — your page is the ledger", () => {
    render(
      <ul>
        <SourceCard place={1} slug="test-crew" member={member("me")} isMe pair={null} />
      </ul>,
    );
    expect(screen.queryByRole("link", { name: "me" })).toBeNull();
  });

  it("stays plain text on /demo and the preview, where the ids are invented", () => {
    render(
      <ul>
        <SourceCard place={1} slug={null} member={member("Hayden")} isMe={false} pair={pair()} />
      </ul>,
    );
    expect(screen.queryByRole("link", { name: "Hayden" })).toBeNull();
  });
});

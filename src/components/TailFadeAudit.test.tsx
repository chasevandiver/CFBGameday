// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TailFadeAudit, type AuditGroup } from "./TailFadeAudit";
import { tally, type Wager } from "../lib/records";

afterEach(cleanup);

/**
 * LEDGER-1 — the audit that replaced the reason tag.
 *
 * The arithmetic itself is `src/lib/tailing.ts`'s and is tested there. What
 * these cover is the presentation contract the ledger depends on: that a viewer
 * with no betting group sees nothing rather than an empty table, that the group
 * name only appears when it disambiguates, and that the section says out loud
 * that nobody types any of it in — which is the whole reason it is better than
 * the tag it replaced.
 */

const w = (n: number): Wager[] =>
  Array.from({ length: n }, () => ({ result: "win" as const, units: 1, payoutUnits: 0.91, clv: 0.5 }));
const l = (n: number): Wager[] =>
  Array.from({ length: n }, () => ({ result: "loss" as const, units: 1, payoutUnits: -1, clv: -0.3 }));

const group = (over: Partial<AuditGroup> = {}): AuditGroup => ({
  groupId: "g1",
  groupName: "Saturday Boys",
  rows: [
    { key: "origin", label: "You got there first", hint: "h", tally: tally([...w(6), ...l(4)]) },
    { key: "tail", label: "You tailed", hint: "h", tally: tally([...w(3), ...l(1)]) },
  ],
  pairs: [{ name: "Jeff", tailing: tally([...w(4), ...l(1)]), fading: tally(l(2)) }],
  ...over,
});

describe("TailFadeAudit", () => {
  it("renders nothing when the viewer is in no betting group", () => {
    const { container } = render(<TailFadeAudit groups={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("keeps the heading the reason-tag table had", () => {
    render(<TailFadeAudit groups={[group()]} />);
    expect(screen.getByText(/Where your edge actually is/)).toBeTruthy();
  });

  it("names the three relations in story order", () => {
    render(<TailFadeAudit groups={[group()]} />);
    expect(screen.getByText("You got there first")).toBeTruthy();
    expect(screen.getByText("You tailed")).toBeTruthy();
  });

  it("shows records and signed units", () => {
    render(<TailFadeAudit groups={[group()]} />);
    expect(screen.getByText("6-4")).toBeTruthy();
    expect(screen.getByText("3-1")).toBeTruthy();
  });

  /* pairStatsFor's question — "am I better off just copying Jeff?" — which
     tailing.ts notes is not answerable from anyone's own record. */
  it("answers riding-them vs taking-them-on, by name", () => {
    render(<TailFadeAudit groups={[group()]} />);
    expect(screen.getByText("Jeff")).toBeTruthy();
    expect(screen.getByText(/Riding them vs taking them on/)).toBeTruthy();
  });

  it("drops the pair table when nobody has been followed", () => {
    render(<TailFadeAudit groups={[group({ pairs: [] })]} />);
    expect(screen.queryByText(/Riding them vs taking them on/)).toBeNull();
  });

  /* Origination means "first in THIS group", so two groups are two crowds and
     pooling them would invent tails. The name appears only when there is
     something to tell apart. */
  it("labels each group only when there is more than one", () => {
    render(<TailFadeAudit groups={[group()]} />);
    expect(screen.queryByText(/Saturday Boys/)).toBeNull();
    cleanup();

    render(
      <TailFadeAudit groups={[group(), group({ groupId: "g2", groupName: "Degens" })]} />,
    );
    expect(screen.getByText(/Saturday Boys/)).toBeTruthy();
    expect(screen.getByText(/Degens/)).toBeTruthy();
  });

  /* The claim that makes this better than the tag it replaced, stated on the
     page rather than only in a commit message. */
  it("says nobody enters any of it", () => {
    render(<TailFadeAudit groups={[group()]} />);
    expect(screen.getByText(/Nobody types any of this in/)).toBeTruthy();
  });
});

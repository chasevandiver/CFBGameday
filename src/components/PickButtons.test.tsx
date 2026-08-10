// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PickButtons } from "./PickButtons";

vi.mock("../app/actions/picks", () => ({
  makePick: vi.fn(async () => ({ ok: true })),
  removePick: vi.fn(async () => ({ ok: true })),
}));

afterEach(cleanup);

const base = {
  groupId: "g-1",
  gameId: 1,
  homeLabel: "ALA",
  awayLabel: "UGA",
  currentSpread: -2.5,
  currentTotal: 51.5,
  markets: ["spread", "total"] as const,
  myPicks: [],
  kickoffPassed: false,
  kickoffTs: null,
  signedIn: true,
};

describe("PickButtons", () => {
  it("signed-out visitors get a sign-in prompt, not dead buttons", () => {
    render(<PickButtons {...base} markets={[...base.markets]} signedIn={false} />);
    expect(screen.getByRole("link", { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers both spread sides and both sides of the total", () => {
    render(<PickButtons {...base} markets={[...base.markets]} />);
    expect(screen.getByRole("button", { name: "UGA +2.5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ALA -2.5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Over 51.5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Under 51.5" })).toBeTruthy();
  });

  it("renders only the markets the group turned on", () => {
    // A spreads-only pool should not see four dead totals buttons.
    render(<PickButtons {...base} markets={["spread"]} />);
    expect(screen.getByRole("button", { name: "ALA -2.5" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Over/ })).toBeNull();
  });

  it("offers straight-up as winner buttons with no number attached", () => {
    render(<PickButtons {...base} markets={["straight_up"]} currentSpread={null} />);
    expect(screen.getByRole("button", { name: "ALA to win" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "UGA to win" })).toBeTruthy();
  });

  it("leaves straight-up enabled on a game no book has priced", () => {
    // The whole point of a winner pick: it needs no line to exist.
    render(
      <PickButtons {...base} markets={["straight_up"]} currentSpread={null} currentTotal={null} />,
    );
    expect((screen.getByRole("button", { name: "ALA to win" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("disables a priced market with no line instead of hiding it", () => {
    render(<PickButtons {...base} markets={[...base.markets]} currentTotal={null} />);
    expect((screen.getByRole("button", { name: "Over –" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "ALA -2.5" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("marks the current pick pressed and shows the snapshotted number", () => {
    render(
      <PickButtons
        {...base}
        markets={[...base.markets]}
        myPicks={[{ market: "spread", side: "home", line_at_pick: -3 }]}
      />,
    );
    const active = screen.getByRole("button", { name: "ALA -2.5" });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Your number: ALA -3/)).toBeTruthy();
  });

  it("holds a spread, a total and a winner on the same game at once", () => {
    render(
      <PickButtons
        {...base}
        markets={["spread", "total", "straight_up"]}
        myPicks={[
          { market: "spread", side: "home", line_at_pick: -3 },
          { market: "total", side: "over", line_at_pick: 51.5 },
          { market: "straight_up", side: "away", line_at_pick: null },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "ALA -2.5" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Over 51.5" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "UGA to win" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText(/ALA -3 · Over 51.5 · UGA to win/)).toBeTruthy();
  });

  it("after kickoff, a graded pick shows its result and CLV", () => {
    render(
      <PickButtons
        {...base}
        markets={[...base.markets]}
        kickoffPassed
        myPicks={[{ market: "total", side: "over", line_at_pick: 51.5, result: "win", clv: 1.5 }]}
      />,
    );
    expect(screen.getByText(/Locked: Over 51.5/)).toBeTruthy();
    expect(screen.getByText("win")).toBeTruthy();
    expect(screen.getByText(/CLV \+1.5/)).toBeTruthy();
  });

  it("after kickoff, a straight-up pick reads as a winner, not as a spread", () => {
    render(
      <PickButtons
        {...base}
        markets={["straight_up"]}
        kickoffPassed
        myPicks={[{ market: "straight_up", side: "home", line_at_pick: null, result: "win" }]}
      />,
    );
    expect(screen.getByText(/Locked: ALA to win/)).toBeTruthy();
  });
});

describe("the in-flight tap (audit 08/UX-10)", () => {
  it("buttons clear the 44px touch floor", () => {
    render(<PickButtons {...base} markets={[...base.markets]} />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.className).toContain("min-h-11");
    }
  });

  it("paints the pick on the tap, not on the response", async () => {
    const { makePick } = await import("../app/actions/picks");
    let release!: (v: { ok: boolean }) => void;
    vi.mocked(makePick).mockImplementationOnce(
      () => new Promise((r) => { release = r; }),
    );
    render(<PickButtons {...base} markets={[...base.markets]} />);
    const tapped = screen.getByRole("button", { name: "UGA +2.5" });
    const sibling = screen.getByRole("button", { name: "ALA -2.5" });
    const { fireEvent, waitFor } = await import("@testing-library/react");
    fireEvent.click(tapped);
    // Picked immediately, while the write is still out — this is the whole
    // point: eight picks should not cost eight round-trips of waiting.
    await waitFor(() => expect(tapped.getAttribute("aria-pressed")).toBe("true"));
    expect(tapped.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText(/Your number: UGA \+2.5/)).toBeTruthy();
    // Every button stays tappable mid-write, so a second pick doesn't bounce.
    expect((tapped as HTMLButtonElement).disabled).toBe(false);
    expect((sibling as HTMLButtonElement).disabled).toBe(false);
    // The in-flight cue is on the button you pressed and nowhere else.
    expect(sibling.getAttribute("aria-busy")).toBeNull();
    expect(sibling.getAttribute("aria-pressed")).toBe("false");
    release({ ok: true });
    await waitFor(() => expect(tapped.getAttribute("aria-busy")).toBeNull());
    expect(tapped.getAttribute("aria-pressed")).toBe("true");
  });

  it("a rejected write puts the button back and says why", async () => {
    const { makePick } = await import("../app/actions/picks");
    vi.mocked(makePick).mockImplementationOnce(async () => ({
      ok: false,
      message: "That game has kicked off",
    }));
    render(<PickButtons {...base} markets={["spread"]} />);
    const tapped = screen.getByRole("button", { name: "UGA +2.5" });
    const { fireEvent, waitFor } = await import("@testing-library/react");
    fireEvent.click(tapped);
    await waitFor(() => expect(screen.getByText("That game has kicked off")).toBeTruthy());
    expect(tapped.getAttribute("aria-pressed")).toBe("false");
  });
});

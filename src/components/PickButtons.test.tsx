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
  gameId: 1,
  homeLabel: "ALA",
  awayLabel: "UGA",
  currentSpread: -2.5,
  currentTotal: 51.5,
  myPick: null,
  kickoffPassed: false,
  kickoffTs: null,
  signedIn: true,
};

describe("PickButtons", () => {
  it("signed-out visitors get a sign-in prompt, not dead buttons", () => {
    render(<PickButtons {...base} signedIn={false} />);
    expect(screen.getByRole("link", { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers both spread sides and both sides of the total", () => {
    render(<PickButtons {...base} />);
    expect(screen.getByRole("button", { name: "UGA +2.5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ALA -2.5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Over 51.5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Under 51.5" })).toBeTruthy();
  });

  it("disables markets with no line instead of hiding them", () => {
    render(<PickButtons {...base} currentTotal={null} />);
    expect((screen.getByRole("button", { name: "Over –" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "ALA -2.5" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("marks the current pick pressed and shows the snapshotted number", () => {
    render(<PickButtons {...base} myPick={{ side: "home", line_at_pick: -3 }} />);
    const active = screen.getByRole("button", { name: "ALA -2.5" });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Your number: ALA -3/)).toBeTruthy();
  });

  it("after kickoff, a graded pick shows its result and CLV", () => {
    render(
      <PickButtons
        {...base}
        kickoffPassed
        myPick={{ side: "over", line_at_pick: 51.5, result: "win", clv: 1.5 }}
      />,
    );
    expect(screen.getByText(/Locked: Over 51.5/)).toBeTruthy();
    expect(screen.getByText("win")).toBeTruthy();
    expect(screen.getByText(/CLV \+1.5/)).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logBet } from "../app/actions/bets";
import { BetForm, type BetFormGame } from "./BetForm";

vi.mock("../app/actions/bets", () => ({
  logBet: vi.fn(async () => ({ ok: true })),
}));

afterEach(cleanup);

const games: BetFormGame[] = [
  {
    id: 401,
    label: "UGA @ BAMA · Sat 2:30 PM CT",
    homeAbbr: "BAMA",
    awayAbbr: "UGA",
    lines: { spread: -6.5, total: 52.5, mlHome: -260, mlAway: 210, status: "final" },
  },
  {
    id: 402,
    label: "OU @ TEX · Sat 11:00 AM CT",
    homeAbbr: "TEX",
    awayAbbr: "OU",
    lines: { spread: 3, total: 48, mlHome: 130, mlAway: -150, status: "scheduled" },
  },
];

const hidden = (name: string) =>
  (document.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement).value;

describe("BetForm suggestions (0083 follow-up)", () => {
  it("picking the favorite fills the closing spread with its sign, and says so", () => {
    render(<BetForm seasonId={2026} games={games} />);
    fireEvent.change(screen.getByLabelText(/^Game/), { target: { value: "401" } });
    fireEvent.change(screen.getByLabelText(/^Side/), { target: { value: "home" } });
    expect(hidden("line_taken")).toBe("-6.5");
    expect(hidden("odds")).toBe("-110");
    expect(screen.getByText("closing line")).toBeTruthy();
  });

  it("the dog gets the same number flipped, a scheduled game says current", () => {
    render(<BetForm seasonId={2026} games={games} />);
    fireEvent.change(screen.getByLabelText(/^Game/), { target: { value: "402" } });
    fireEvent.change(screen.getByLabelText(/^Side/), { target: { value: "away" } });
    // TEX is +3 at home, so OU lays 3
    expect(hidden("line_taken")).toBe("-3");
    expect(screen.getByText("current line")).toBeTruthy();
  });

  it("a moneyline fills the price and leaves the line blank", () => {
    render(<BetForm seasonId={2026} games={games} />);
    fireEvent.change(screen.getByLabelText(/^Game/), { target: { value: "401" } });
    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: "moneyline" } });
    fireEvent.change(screen.getByLabelText(/^Side/), { target: { value: "away" } });
    expect(hidden("odds")).toBe("+210");
    expect(hidden("line_taken")).toBe("");
  });

  it("a total is unsigned and offers no sign button for the line", () => {
    render(<BetForm seasonId={2026} games={games} />);
    fireEvent.change(screen.getByLabelText(/^Game/), { target: { value: "401" } });
    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: "total" } });
    fireEvent.change(screen.getByLabelText(/^Side/), { target: { value: "over" } });
    expect(hidden("line_taken")).toBe("52.5");
    // one sign button left: the odds'
    expect(screen.getAllByRole("button", { name: /^Sign:/ })).toHaveLength(1);
  });

  it("the sign is a button, so a favorite can be entered from a keypad with no minus key", () => {
    render(<BetForm seasonId={2026} games={[]} />);
    const line = screen.getByLabelText(/^Line/);
    fireEvent.change(line, { target: { value: "6.5" } });
    expect(hidden("line_taken")).toBe("-6.5");
    fireEvent.click(screen.getAllByRole("button", { name: /^Sign:/ })[0]);
    expect(hidden("line_taken")).toBe("+6.5");
  });

  it("a hand-edited number survives until the next selection, then is re-suggested", () => {
    render(<BetForm seasonId={2026} games={games} />);
    fireEvent.change(screen.getByLabelText(/^Game/), { target: { value: "401" } });
    fireEvent.change(screen.getByLabelText(/^Side/), { target: { value: "home" } });
    fireEvent.change(screen.getByLabelText(/^Line/), { target: { value: "7" } });
    expect(hidden("line_taken")).toBe("-7");
    // the hint drops once the number is no longer the suggestion
    expect(screen.queryByText("closing line")).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Side/), { target: { value: "away" } });
    expect(hidden("line_taken")).toBe("+6.5");
  });

  it("without a captured line nothing is suggested and the default price stands", () => {
    render(
      <BetForm
        seasonId={2026}
        games={[{ ...games[0], lines: { ...games[0].lines!, spread: null } }]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^Game/), { target: { value: "401" } });
    fireEvent.change(screen.getByLabelText(/^Side/), { target: { value: "home" } });
    expect(hidden("line_taken")).toBe("");
    expect(hidden("odds")).toBe("-110");
  });
});

describe("BetForm for a betting-group admin (LOGF-7)", () => {
  const bettors = [
    { id: "me", name: "Me" },
    { id: "hayden", name: "hayden.vinz" },
    { id: "eric", name: "ericjamesglenn" },
  ];
  const forUsers = () =>
    [...document.querySelectorAll('input[type="hidden"][name="for_user"]')].map(
      (el) => (el as HTMLInputElement).value,
    );

  it("opens on the member chosen, and a tail is one more tap", () => {
    render(<BetForm seasonId={2026} games={games} bettors={bettors} defaultBettorIds={["hayden"]} />);
    expect(forUsers()).toEqual(["hayden"]);
    fireEvent.click(screen.getByRole("button", { name: /ericjamesglenn/ }));
    expect(forUsers()).toEqual(["hayden", "eric"]);
    fireEvent.click(screen.getByRole("button", { name: /hayden\.vinz/ }));
    expect(forUsers()).toEqual(["eric"]);
  });

  it("without a roster there is no who-picker and the single member still rides along", () => {
    render(<BetForm seasonId={2026} games={games} forUserId="hayden" />);
    expect(screen.queryByText("Who")).toBeNull();
    expect(forUsers()).toEqual(["hayden"]);
  });

  it("the description writes itself from the game, side and number", () => {
    render(
      <BetForm
        seasonId={2026}
        games={[{ ...games[0], homeName: "Alabama", awayName: "Georgia" }]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^Game/), { target: { value: "401" } });
    fireEvent.change(screen.getByLabelText(/^Side/), { target: { value: "away" } });
    const desc = screen.getByLabelText(/^Bet/) as HTMLInputElement;
    expect(desc.placeholder).toBe("Georgia +6.5 (UGA @ BAMA)");
    expect(desc.required).toBe(false);
  });

  it("an empty description is sent as the written one, for everyone ticked", async () => {
    render(
      <BetForm
        seasonId={2026}
        games={[{ ...games[0], homeName: "Alabama", awayName: "Georgia" }]}
        bettors={bettors}
        defaultBettorIds={["hayden"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ericjamesglenn/ }));
    fireEvent.change(screen.getByLabelText(/^Game/), { target: { value: "401" } });
    fireEvent.change(screen.getByLabelText(/^Side/), { target: { value: "away" } });
    fireEvent.change(screen.getByLabelText(/^Units/), { target: { value: "1" } });
    fireEvent.submit(screen.getByRole("button", { name: "Log bet" }).closest("form")!);
    await waitFor(() => expect(logBet).toHaveBeenCalled());
    const fd = vi.mocked(logBet).mock.calls.at(-1)![0] as FormData;
    expect(fd.get("description")).toBe("Georgia +6.5 (UGA @ BAMA)");
    expect(fd.getAll("for_user")).toEqual(["hayden", "eric"]);
    expect(await screen.findByText("Logged for hayden.vinz and ericjamesglenn ✓")).toBeTruthy();
  });

  it("with nothing to describe it from, the description is still required", () => {
    render(<BetForm seasonId={2026} games={games} />);
    expect((screen.getByLabelText(/^Bet/) as HTMLInputElement).required).toBe(true);
  });

  it("the search box narrows the game list by team, and files games by day", () => {
    render(
      <BetForm
        seasonId={2026}
        games={[
          { ...games[0], group: "Sat Oct 10 · CFB", homeName: "Alabama", awayName: "Georgia" },
          { ...games[1], group: "Sat Oct 10 · CFB", homeName: "Texas", awayName: "Oklahoma" },
        ]}
      />,
    );
    const options = () =>
      [...(screen.getByLabelText(/^Game/) as HTMLSelectElement).querySelectorAll("option")]
        .map((o) => o.value)
        .filter(Boolean);
    expect(options()).toEqual(["401", "402"]);
    expect(document.querySelector('optgroup[label="Sat Oct 10 · CFB"]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Find game/), { target: { value: "texas" } });
    expect(options()).toEqual(["402"]);
    fireEvent.change(screen.getByLabelText(/^Find game/), { target: { value: "uga bama" } });
    expect(options()).toEqual(["401"]);
  });
});

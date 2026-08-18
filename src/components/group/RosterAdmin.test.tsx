// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RosterAdmin } from "./RosterAdmin";

type Result = { ok: boolean; message?: string };

const search = vi.fn();
const addById = vi.fn<(group: string, userId: string) => Promise<Result>>(async () => ({
  ok: true,
}));
const addByName = vi.fn<(group: string, name: string) => Promise<Result>>(async () => ({
  ok: true,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../../app/actions/groups", () => ({
  searchGroupCandidates: (group: string, q: string) => search(group, q),
  addGroupMember: (group: string, userId: string) => addById(group, userId),
  addGroupMemberByName: (group: string, name: string) => addByName(group, name),
  leaveGroup: vi.fn(async () => ({ ok: true })),
  removeGroupMember: vi.fn(async () => ({ ok: true })),
  setGroupRole: vi.fn(async () => ({ ok: true })),
}));

const base = {
  groupId: "g-1",
  members: [
    { userId: "u-1", name: "ann", role: "admin" as const, joinedAt: "2026-08-01T12:00:00Z" },
    { userId: "u-2", name: "bob", role: "member" as const, joinedAt: "2026-08-02T12:00:00Z" },
  ],
  viewerId: "u-1",
  viewerIsAdmin: true,
};

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText(/add someone by name/i), { target: { value } });

beforeEach(() => {
  search.mockReset();
  search.mockResolvedValue({ ok: true, people: [] });
  addById.mockClear();
  addByName.mockClear();
});
afterEach(cleanup);

/**
 * The join code is the other way in and is covered by the DB suite. What is
 * only testable here is that the admin's second door exists, that it never
 * appears for a member, and that picking a name off the list adds *that* row —
 * `display_name` is not unique, so an add that fell back to the typed name
 * after a row was clicked could put the wrong person on the board.
 */
describe("RosterAdmin", () => {
  it("offers no way to add people to a plain member", () => {
    render(<RosterAdmin {...base} viewerIsAdmin={false} viewerId="u-2" />);
    expect(screen.queryByLabelText(/add someone by name/i)).toBeNull();
  });

  it("does not search on one character, and does on two", async () => {
    render(<RosterAdmin {...base} />);
    type("c");
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalled();

    type("cal");
    await waitFor(() => expect(search).toHaveBeenCalledWith("g-1", "cal"));
  });

  it("adds the row that was clicked, by id", async () => {
    search.mockResolvedValue({
      ok: true,
      people: [
        { id: "u-3", name: "cal", membership: "none" },
        { id: "u-4", name: "cal", membership: "none" },
      ],
    });
    render(<RosterAdmin {...base} />);
    type("cal");

    // Two accounts share the name; the second row is a different person.
    const rows = await screen.findAllByRole("button", { name: "Add cal" });
    fireEvent.click(rows[1]);
    await waitFor(() => expect(addById).toHaveBeenCalledWith("g-1", "u-4"));
    expect(addByName).not.toHaveBeenCalled();
  });

  it("says who is already in rather than offering to add them twice", async () => {
    search.mockResolvedValue({
      ok: true,
      people: [{ id: "u-2", name: "bob", membership: "member" }],
    });
    render(<RosterAdmin {...base} />);
    type("bob");

    expect(await screen.findByText("already in")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Add bob$/ })).toBeNull();
  });

  it("offers a removed member back rather than pretending they are new", async () => {
    search.mockResolvedValue({
      ok: true,
      people: [{ id: "u-5", name: "cal", membership: "removed" }],
    });
    render(<RosterAdmin {...base} />);
    type("cal");

    fireEvent.click(await screen.findByRole("button", { name: "Add back cal" }));
    await waitFor(() => expect(addById).toHaveBeenCalledWith("g-1", "u-5"));
  });

  it("takes a typed name when no row was picked, and shows the refusal", async () => {
    addByName.mockResolvedValueOnce({
      ok: false,
      message: "More than one person is named cal — pick them from the list",
    });
    render(<RosterAdmin {...base} />);
    type("cal");
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => expect(addByName).toHaveBeenCalledWith("g-1", "cal"));
    expect(await screen.findByText(/more than one person is named cal/i)).toBeTruthy();
  });
});

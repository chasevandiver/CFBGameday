// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupRoster } from "./GroupRoster";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

const members = [
  { userId: "u-1", name: "chasevandiver", role: "admin" as const, joinedAt: "2026-08-01T14:00:00Z" },
  { userId: "u-2", name: "hayden.vinz", role: "member" as const, joinedAt: new Date().toISOString() },
];

/**
 * The report this section answers: somebody was added and it "didn't pop
 * anywhere that he was in the group". Every group home already listed its
 * members, but only through a leaderboard — and a member with nothing graded
 * reads as a rounding error rather than as a member.
 */
describe("GroupRoster", () => {
  it("lists everyone, whether or not they have done anything", () => {
    render(<GroupRoster members={members} viewerId="u-1" slug="degens" isAdmin />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText(/hayden\.vinz/)).toBeTruthy();
  });

  it("marks the admin and the viewer", () => {
    render(<GroupRoster members={members} viewerId="u-1" slug="degens" isAdmin />);
    const mine = screen.getAllByRole("listitem")[0];
    expect(within(mine).getByText("(you)")).toBeTruthy();
    expect(within(mine).getByText("admin")).toBeTruthy();
  });

  it("says a just-added member joined today, which is the whole point", () => {
    render(<GroupRoster members={members} viewerId="u-1" slug="degens" isAdmin />);
    expect(screen.getByText("joined today")).toBeTruthy();
  });

  it("offers the way to add someone to an admin, and not to anyone else", () => {
    const { unmount } = render(
      <GroupRoster members={members} viewerId="u-1" slug="degens" isAdmin />,
    );
    expect(screen.getByRole("link", { name: /add someone/i }).getAttribute("href")).toBe(
      "/groups/degens/settings",
    );
    unmount();

    render(<GroupRoster members={members} viewerId="u-2" slug="degens" isAdmin={false} />);
    expect(screen.queryByRole("link", { name: /add someone/i })).toBeNull();
  });
});

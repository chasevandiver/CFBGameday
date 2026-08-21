// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareButton } from "./ShareButton";

vi.mock("../lib/session-picks", () => ({ useSessionPicks: () => [] }));

afterEach(cleanup);

/**
 * POOL-4. Owner report: the share menu "doesn't pop anything up — it looks
 * like it's getting caught where it doesn't show up because it's being clipped
 * by another card."
 *
 * Two faults, either fatal on its own. The menu opened DOWNWARD from a button
 * in PickBoard's fixed bottom bar, where there is no "below"; and it sat at
 * z-30 inside that bar's z-20 stacking context, which cannot rise above the
 * bottom nav at z-40. Both are fixed by portalling to document.body.
 */
const context = {
  groupName: "Crew",
  userName: "Chase",
  today: [],
  week: 1,
  record: null,
  lifetime: null,
} as unknown as Parameters<typeof ShareButton>[0]["context"];

const openMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: /share/i }));
};

describe("the share menu escapes its container", () => {
  it("renders outside the button's subtree, where no ancestor can clip it", () => {
    const { container } = render(
      // The shape that broke it: a fixed, z-20, overflow-hidden bar.
      <div className="fixed bottom-0 z-20 overflow-hidden">
        <ShareButton context={context} />
      </div>,
    );
    openMenu();
    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();
    // The proof: it is in the document but NOT inside the clipping ancestor.
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it("sits above the bottom nav rather than under it", () => {
    render(<ShareButton context={context} />);
    openMenu();
    // The nav is z-40. A menu that cannot beat it is a menu nobody sees.
    expect(screen.getByRole("menu").className).toContain("z-50");
  });

  it("opens upward when there is no room below", () => {
    // A button pinned to the bottom of the viewport: the reported case.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 760,
      bottom: 800,
      left: 200,
      right: 360,
      width: 160,
      height: 40,
      x: 200,
      y: 760,
      toJSON: () => ({}),
    } as DOMRect);
    render(<ShareButton context={context} />);
    openMenu();
    const menu = screen.getByRole("menu") as HTMLElement;
    // Anchored from the bottom, not the top — the old `mt-1.5` put it
    // off-screen.
    expect(menu.style.bottom).not.toBe("");
    expect(menu.style.top).toBe("");
    vi.restoreAllMocks();
  });

  it("opens downward when there is room, which is the ledger header's case", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 80,
      bottom: 120,
      left: 200,
      right: 360,
      width: 160,
      height: 40,
      x: 200,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect);
    render(<ShareButton context={context} />);
    openMenu();
    const menu = screen.getByRole("menu") as HTMLElement;
    expect(menu.style.top).not.toBe("");
    expect(menu.style.bottom).toBe("");
    vi.restoreAllMocks();
  });
});

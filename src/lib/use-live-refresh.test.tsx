// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveRefresh } from "./use-live-refresh";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setVisibility("visible");
});

beforeEach(() => {
  vi.useFakeTimers();
});

/**
 * `document.visibilityState` is a read-only getter; the poller reads it on
 * every tick, so the tests need to move it.
 */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function Probe({ refresh, ms }: { refresh: () => void; ms: number }) {
  useLiveRefresh(refresh, ms);
  return null;
}

describe("useLiveRefresh", () => {
  it("polls on the wall clock, not on mount", () => {
    const refresh = vi.fn();
    render(<Probe refresh={refresh} ms={30_000} />);
    // the server just rendered this data — mounting is not a reason to refetch
    expect(refresh).toHaveBeenCalledTimes(0);
    act(() => void vi.advanceTimersByTime(29_000));
    expect(refresh).toHaveBeenCalledTimes(0);
    // the comparison ticks every few seconds; the interval is what gates it
    act(() => void vi.advanceTimersByTime(5_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("costs nothing while the tab is hidden", () => {
    const refresh = vi.fn();
    setVisibility("hidden");
    render(<Probe refresh={refresh} ms={30_000} />);
    act(() => void vi.advanceTimersByTime(120_000));
    expect(refresh).toHaveBeenCalledTimes(0);
  });

  /* The bug this hook exists for: an iPad's tab comes back after a sleep with
     the old interval armed for a full fresh period, and the viewer stares at a
     stale score until they navigate away and back. */
  it("refreshes the moment the page becomes visible again", () => {
    const refresh = vi.fn();
    setVisibility("hidden");
    render(<Probe refresh={refresh} ms={30_000} />);
    act(() => void vi.advanceTimersByTime(600_000));
    expect(refresh).toHaveBeenCalledTimes(0);

    setVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes on focus, bfcache restore and the network coming back", () => {
    for (const [target, event] of [
      [window, "focus"],
      [window, "pageshow"],
      [window, "online"],
    ] as const) {
      const refresh = vi.fn();
      const view = render(<Probe refresh={refresh} ms={60_000} />);
      act(() => void vi.advanceTimersByTime(10_000));
      act(() => void target.dispatchEvent(new Event(event)));
      expect(refresh, event).toHaveBeenCalledTimes(1);
      view.unmount();
    }
  });

  it("ignores a wake it has just answered, so the events don't stack", () => {
    const refresh = vi.fn();
    render(<Probe refresh={refresh} ms={60_000} />);
    act(() => void vi.advanceTimersByTime(10_000));
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => window.dispatchEvent(new Event("pageshow")));
    act(() => window.dispatchEvent(new Event("online")));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /* Shortening the interval — a game kicks off — must measure against the last
     run, not restart the countdown. The old effect re-created its interval on
     every dependency change, so a value that flipped often could starve it. */
  it("keeps the elapsed clock when the interval changes", () => {
    const refresh = vi.fn();
    const view = render(<Probe refresh={refresh} ms={120_000} />);
    act(() => void vi.advanceTimersByTime(45_000));
    expect(refresh).toHaveBeenCalledTimes(0);
    view.rerender(<Probe refresh={refresh} ms={30_000} />);
    act(() => void vi.advanceTimersByTime(4_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops on unmount", () => {
    const refresh = vi.fn();
    const view = render(<Probe refresh={refresh} ms={30_000} />);
    view.unmount();
    act(() => void vi.advanceTimersByTime(120_000));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(refresh).toHaveBeenCalledTimes(0);
  });
});

// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeAutoRefresh } from "./HomeAutoRefresh";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * The hub is a server component, so its only way to update is
 * `router.refresh()`. That makes this wiring the whole feature: if the call
 * never fires, the page silently never moves — which is exactly what "the home
 * screen isn't refreshing at all" looked like, and is worth a test rather than
 * an assumption.
 */
describe("HomeAutoRefresh", () => {
  it("re-renders the server tree on the live cadence", () => {
    render(<HomeAutoRefresh live imminent />);
    expect(refresh).toHaveBeenCalledTimes(0); // the server just rendered this
    act(() => void vi.advanceTimersByTime(34_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(32_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  /* The tier that caused the report: with nothing live and nothing imminent
     the hub waits five minutes, so wiring a live game to `live={false}` reads
     as a page that never refreshes. homeRefreshTier is what decides this, and
     it is tested against the reported case in home.test.ts. */
  it("waits far longer when nothing is happening", () => {
    render(<HomeAutoRefresh live={false} imminent={false} />);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(refresh).toHaveBeenCalledTimes(0);
    act(() => void vi.advanceTimersByTime(245_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes the moment the tab comes back, whatever the tier", () => {
    render(<HomeAutoRefresh live={false} imminent={false} />);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(0);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

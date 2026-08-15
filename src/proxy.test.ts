import { describe, expect, it } from "vitest";
import { config } from "./proxy";

/**
 * The matcher decides how much auth traffic the app makes (AUTH-2).
 *
 * It is one regex in a config object, which is exactly the kind of thing that
 * gets edited later by someone adding an exclusion and quietly re-including
 * `/api`. The cost of that is invisible — the app still works, it just doubles
 * the GoTrue round trips on every poll and widens the window for a refresh
 * collision. So the rule is asserted rather than commented.
 */
const runsProxyOn = (path: string): boolean =>
  config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

describe("proxy matcher", () => {
  it("refreshes the session on pages", () => {
    for (const path of ["/", "/slate", "/groups/saturday-boys", "/game/401", "/me"]) {
      expect(runsProxyOn(path), path).toBe(true);
    }
  });

  it("stays off /api — those routes read the same cookies themselves", () => {
    for (const path of ["/api/ticker", "/api/slate", "/api/game/401", "/api/push/resubscribe"]) {
      expect(runsProxyOn(path), path).toBe(false);
    }
  });

  it("stays off static assets", () => {
    for (const path of ["/_next/static/chunk.js", "/favicon.ico", "/icons/icon-192.png"]) {
      expect(runsProxyOn(path), path).toBe(false);
    }
  });

  it("still covers the magic-link landing, which sets the session cookies", () => {
    expect(runsProxyOn("/auth/confirm")).toBe(true);
  });
});

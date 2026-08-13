import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The watchdog's push channel (OPS-2).
 *
 * `notifyWatchdog` is the one notification path whose whole job is to work when
 * something else is already broken, so the properties worth pinning are the
 * defensive ones: it must not throw, it must not fan out to non-admins, and it
 * must not buzz once per watchdog run.
 *
 * `src/lib/push` is mocked rather than stubbed at the network layer — the
 * module reads VAPID keys at import and talks to a push service, neither of
 * which belongs in a unit test.
 */
const sendToUser = vi.fn();
const activeSettings = vi.fn();
const pushConfigured = vi.fn(() => true);

vi.mock("../../src/lib/push", () => ({
  sendToUser: (...args: unknown[]) => sendToUser(...args),
  activeSettings: (...args: unknown[]) => activeSettings(...args),
  pushConfigured: () => pushConfigured(),
  fill: (t: string, v: Record<string, string | number>) =>
    t.replace(/\{\{(\w+)\}\}/g, (whole, k: string) => (k in v ? String(v[k]) : whole)),
}));

const { notifyWatchdog } = await import("./notify-jobs");

/** Minimal stand-in for the one query notifyWatchdog makes. */
const dbWithAdmins = (ids: string[]) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: ids.map((id) => ({ id })) }),
      }),
    }),
  }) as never;

beforeEach(() => {
  sendToUser.mockReset();
  activeSettings.mockReset();
  pushConfigured.mockReset().mockReturnValue(true);
  sendToUser.mockResolvedValue({ sent: 1, duplicate: false, pruned: 0 });
  activeSettings.mockResolvedValue({
    lead_minutes: 0,
    title: "A job went silent",
    body: "{{jobs}} — no good run inside the expected cadence.",
  });
});

describe("notifyWatchdog", () => {
  it("sends one push per admin and fills the job list into the copy", async () => {
    const res = await notifyWatchdog(dbWithAdmins(["a", "b"]), ["sync-games silent 31h"], "2026-08-13");
    expect(res).toEqual({ notified: 2, errors: 0 });
    const [, userId, kind, subject, payload] = sendToUser.mock.calls[0];
    expect(userId).toBe("a");
    expect(kind).toBe("watchdog");
    expect(subject).toBe("watchdog:2026-08-13:sync-games silent 31h");
    expect(payload.body).toContain("sync-games silent 31h");
    expect(payload.url).toBe("/admin");
  });

  it("keys the receipt on the DAY, so three runs a day buzz once", async () => {
    // The watchdog runs on `0 8,14,20 * * *`. Keying the dedupe on the problem
    // alone would re-notify on every run until the job recovers.
    const db = dbWithAdmins(["a"]);
    await notifyWatchdog(db, ["sync-games silent 31h"], "2026-08-13");
    await notifyWatchdog(db, ["sync-games silent 37h"], "2026-08-13");
    const subjects = sendToUser.mock.calls.map((c) => c[3]);
    expect(subjects[0]).toContain("2026-08-13");
    expect(subjects[1]).toContain("2026-08-13");
    // Different problem text is a different subject by design — a NEW job going
    // silent is news. The same text on the same day is not, and dedupes in
    // notification_sends on its unique (user, kind, subject).
    expect(new Set(subjects).size).toBe(2);
  });

  it("says nothing when there are no problems", async () => {
    const res = await notifyWatchdog(dbWithAdmins(["a"]), [], "2026-08-13");
    expect(res).toEqual({ notified: 0, errors: 0 });
    expect(sendToUser).not.toHaveBeenCalled();
    expect(activeSettings).not.toHaveBeenCalled();
  });

  it("says nothing when push is not configured", async () => {
    pushConfigured.mockReturnValue(false);
    const res = await notifyWatchdog(dbWithAdmins(["a"]), ["x"], "2026-08-13");
    expect(res).toEqual({ notified: 0, errors: 0 });
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it("respects the admin switch in notification_settings", async () => {
    activeSettings.mockResolvedValue(null);
    const res = await notifyWatchdog(dbWithAdmins(["a"]), ["x"], "2026-08-13");
    expect(res).toEqual({ notified: 0, errors: 0 });
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it("does nothing, quietly, when there are no admins", async () => {
    const res = await notifyWatchdog(dbWithAdmins([]), ["x"], "2026-08-13");
    expect(res).toEqual({ notified: 0, errors: 0 });
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it("never throws, so it cannot replace the fault it is reporting", async () => {
    // The caller raises the real watchdog error on the next line. If a push
    // failure propagated, the red run would say "push failed" instead of
    // naming the job that went silent — losing the actual signal.
    sendToUser.mockRejectedValue(new Error("push service down"));
    const res = await notifyWatchdog(dbWithAdmins(["a"]), ["x"], "2026-08-13");
    expect(res).toEqual({ notified: 0, errors: 1 });
  });

  it("survives the settings lookup itself failing", async () => {
    activeSettings.mockRejectedValue(new Error("db gone"));
    await expect(notifyWatchdog(dbWithAdmins(["a"]), ["x"], "2026-08-13")).resolves.toEqual({
      notified: 0,
      errors: 1,
    });
  });
});

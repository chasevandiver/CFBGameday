import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fill, sendToUser } from "./push";

/**
 * The dedupe is the whole safety property of this feature: the scoreboard job
 * re-observes the same cover flip on every 30-second tick, and the picks-due
 * job runs on three overlapping crons. Neither is allowed to notify twice.
 *
 * These exercise `sendToUser` against a stub client rather than a database,
 * because what is being tested is the ORDER of operations — receipt first,
 * push second — not any SQL.
 */

interface Recorded {
  inserted: number;
  updates: Record<string, unknown>[];
}

/**
 * Minimal stand-in for the query builder, covering exactly the calls
 * `sendToUser` makes. `insertError` simulates the unique-violation the dedupe
 * relies on.
 */
function stubDb(opts: {
  insertError?: { code: string; message: string };
  devices?: { id: number; endpoint: string; p256dh: string; auth: string }[];
  pref?: { enabled: boolean } | null;
}): { db: SupabaseClient; recorded: Recorded } {
  const recorded: Recorded = { inserted: 0, updates: [] };

  const chain = (table: string) => {
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = self;
    builder.eq = self;
    builder.is = self;
    builder.insert = () => {
      recorded.inserted++;
      return Promise.resolve({ error: opts.insertError ?? null });
    };
    builder.update = (patch: Record<string, unknown>) => {
      recorded.updates.push(patch);
      return builder;
    };
    builder.maybeSingle = () =>
      Promise.resolve({ data: table === "notification_prefs" ? (opts.pref ?? null) : null });
    // The subscription lookup awaits the builder directly.
    builder.then = (resolve: (v: { data: unknown }) => unknown) =>
      resolve({ data: table === "push_subscriptions" ? (opts.devices ?? []) : [] });
    return builder;
  };

  return { db: { from: (table: string) => chain(table) } as unknown as SupabaseClient, recorded };
}

describe("fill", () => {
  it("substitutes known tokens", () => {
    expect(fill("{{count}} open in {{group}}", { count: 3, group: "The Crew" })).toBe(
      "3 open in The Crew",
    );
  });

  it("leaves an unknown token visible rather than blanking it", () => {
    // A body reading "{{kickoff}}" is a bug someone fixes. An empty gap in a
    // sentence looks like it was written that way and ships forever.
    expect(fill("first kick {{kickoff}}", {})).toBe("first kick {{kickoff}}");
  });
});

describe("sendToUser", () => {
  it("treats a unique violation on the receipt as already-sent", async () => {
    const { db, recorded } = stubDb({
      insertError: { code: "23505", message: "duplicate key" },
      devices: [{ id: 1, endpoint: "https://push.example/x", p256dh: "k", auth: "a" }],
    });
    const result = await sendToUser(db, "user-1", "bad_beat", "game:1:spread:home", {
      title: "t",
      body: "b",
    });
    expect(result).toMatchObject({ duplicate: true, sent: 0 });
    // The point: it never reached the push service, so the device is untouched.
    expect(recorded.updates).toHaveLength(0);
  });

  it("records the receipt before it sends", async () => {
    // No devices, so nothing is pushed — but the receipt must already exist,
    // because that insert is what claims the (user, kind, subject) slot against
    // a concurrent detector.
    const { db, recorded } = stubDb({ devices: [] });
    const result = await sendToUser(db, "user-1", "picks_due", "picks:g:1:2", {
      title: "t",
      body: "b",
    });
    expect(recorded.inserted).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.reason).toBe("no devices");
    expect(recorded.updates.at(-1)).toMatchObject({ status: "skipped" });
  });

  it("honours an explicit opt-out without writing a receipt", async () => {
    const { db, recorded } = stubDb({ pref: { enabled: false }, devices: [] });
    const result = await sendToUser(db, "user-1", "bad_beat", "game:2:total:over", {
      title: "t",
      body: "b",
    });
    expect(result.reason).toBe("opted out");
    // No receipt: an opt-out is not a send, and logging it would make the
    // console's "last 20 sent" mostly noise.
    expect(recorded.inserted).toBe(0);
  });

  it("opts in when no preference row exists", async () => {
    const { db, recorded } = stubDb({ pref: null, devices: [] });
    await sendToUser(db, "user-1", "picks_due", "picks:g:1:3", { title: "t", body: "b" });
    expect(recorded.inserted).toBe(1);
  });
});

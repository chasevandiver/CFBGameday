import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addedToGroupPayload, fill, sendToUser } from "./push";

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
  /** What notification_settings says the kind defaults to. */
  defaultEnabled?: boolean;
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
    builder.maybeSingle = () => {
      if (table === "notification_prefs") return Promise.resolve({ data: opts.pref ?? null });
      if (table === "notification_settings")
        return Promise.resolve({ data: { default_enabled: opts.defaultEnabled ?? true } });
      return Promise.resolve({ data: null });
    };
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

describe("addedToGroupPayload", () => {
  const settings = { title: "You’re in {{group}}", body: "{{admin}} added you. Tap to open it." };

  it("names the group and the person who did it", () => {
    // "You were added to Saturday Boys" reads like something the site did.
    // A person is who you ask about it, so the admin is in the copy.
    const p = addedToGroupPayload(settings, { name: "Saturday Boys", slug: "saturday-boys" }, "Chase");
    expect(p.title).toBe("You’re in Saturday Boys");
    expect(p.body).toBe("Chase added you. Tap to open it.");
  });

  it("lands the tap on the group, not the home screen", () => {
    const p = addedToGroupPayload(settings, { name: "Degens", slug: "degens" }, "Chase");
    expect(p.url).toBe("/groups/degens");
  });

  it("carries whatever copy the admin console has stored", () => {
    // The templates are editable from /admin (0066), so the builder must not
    // hardcode the sentence it happens to ship with.
    const p = addedToGroupPayload(
      { title: "{{admin}} put you in a pool", body: "{{group}}" },
      { name: "The Crew", slug: "the-crew" },
      "Ann",
    );
    expect(p.title).toBe("Ann put you in a pool");
    expect(p.body).toBe("The Crew");
  });
});

describe("blanket notifications", () => {
  it("keys a wave by date and hour, not by which game is still upcoming", () => {
    // Regression: the subject used to carry the earliest kickoff still in the
    // window. A run that lagged past the first game filtered it out, promoted
    // the next one, and produced a different subject — a second "log your
    // bets" for a wave already covered. The reminder is one per wave, always.
    const waveKey = (kickoff: string) => {
      const d = new Date(kickoff);
      return `${d.toISOString().slice(0, 10)}:${d.getUTCHours()}`;
    };
    // Two games in the 16:00 UTC wave; either could be "earliest".
    expect(waveKey("2026-09-05T16:00:00Z")).toBe(waveKey("2026-09-05T16:15:00Z"));
    // A different wave the same day is still distinct.
    expect(waveKey("2026-09-05T16:00:00Z")).not.toBe(waveKey("2026-09-05T19:30:00Z"));
    // And so is the same wave a week later.
    expect(waveKey("2026-09-05T16:00:00Z")).not.toBe(waveKey("2026-09-12T16:00:00Z"));
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

  it("falls back to the kind's default when there is no preference row", async () => {
    const { db, recorded } = stubDb({ pref: null, defaultEnabled: true, devices: [] });
    await sendToUser(db, "user-1", "picks_due", "picks:g:1:3", { title: "t", body: "b" });
    expect(recorded.inserted).toBe(1);
  });

  it("stays silent for a kind that defaults off, like bad beats", async () => {
    // The whole reason default_enabled exists: one notification per late swing
    // across a twelve-game Saturday is a firehose, and muting is per-app — it
    // would take picks-due and log-bets down with it.
    const { db, recorded } = stubDb({ pref: null, defaultEnabled: false, devices: [] });
    const result = await sendToUser(db, "user-1", "bad_beat", "game:9:spread:home", {
      title: "t",
      body: "b",
    });
    expect(result.reason).toBe("opted out");
    expect(recorded.inserted).toBe(0);
  });

  it("lets an explicit opt-in beat a default of off", async () => {
    const { db, recorded } = stubDb({ pref: { enabled: true }, defaultEnabled: false, devices: [] });
    await sendToUser(db, "user-1", "bad_beat", "game:10:total:over", { title: "t", body: "b" });
    expect(recorded.inserted).toBe(1);
  });
});

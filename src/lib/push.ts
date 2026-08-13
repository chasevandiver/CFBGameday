import webpush, { WebPushError } from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Web Push sending (docs/STATUS.md PUSH-1).
 *
 * Lives in src/ rather than scripts/ because both callers need it: the job
 * runner imports it for scheduled triggers, and the server actions import it
 * for the test button and the admin console.
 *
 * Every send goes through `sendToUser`, which writes a `notification_sends`
 * row before it writes to the push service. That row is the dedupe key as well
 * as the receipt — the same (user, kind, subject) can only ever be inserted
 * once, so a detector that fires twice cannot notify twice, and it does not
 * matter how many times the scoreboard loop re-observes the same cover flip.
 */

export type NotificationKind = "picks_due" | "bad_beat" | "log_bets" | "admin" | "watchdog";

export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap should land. Relative to the site root. */
  url?: string;
}

/** One device. */
interface Subscription {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let configured = false;

/**
 * VAPID identifies the sender to the push service. `web-push` throws on send
 * if this has not run, so it runs lazily on first use rather than at import —
 * importing this module during a build that has no secrets should not explode.
 */
function configure() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@thecfbslate.app";
  if (!publicKey || !privateKey) {
    throw new Error(
      "push is not configured: set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY",
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

/** Whether sending is possible at all. Lets callers degrade instead of throw. */
export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Fill `{{token}}` placeholders in an admin-editable template.
 *
 * Unknown tokens are left alone rather than blanked: a body that reads
 * "{{kickoff}}" is a visible bug someone will fix, where an empty gap in a
 * sentence looks like it was written that way.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/** The kind's row from `notification_settings`, or null when it is switched off. */
export async function activeSettings(
  db: SupabaseClient,
  kind: NotificationKind,
): Promise<{ lead_minutes: number; title: string; body: string } | null> {
  const { data } = await db
    .from("notification_settings")
    .select("enabled, lead_minutes, title, body")
    .eq("kind", kind)
    .maybeSingle();
  if (!data?.enabled) return null;
  return { lead_minutes: data.lead_minutes, title: data.title, body: data.body };
}

/**
 * Whether a kind is on for someone who has never touched the switch.
 *
 * Read from `notification_settings.default_enabled` rather than assumed, so the
 * answer is admin-editable. Bad beats default OFF: one per late swing across a
 * twelve-game Saturday is a firehose nobody asked for, and the kinds people do
 * want get muted along with it, because muting is per-app.
 */
export async function kindDefaults(db: SupabaseClient): Promise<Record<string, boolean>> {
  const { data } = await db.from("notification_settings").select("kind, default_enabled");
  const out: Record<string, boolean> = {};
  for (const row of (data ?? []) as { kind: string; default_enabled: boolean }[]) {
    out[row.kind] = row.default_enabled;
  }
  return out;
}

export interface SendResult {
  /** Devices the push service accepted. */
  sent: number;
  /** Rows skipped because this exact notification already went out. */
  duplicate: boolean;
  /** Subscriptions retired because the push service said they are gone. */
  pruned: number;
  reason?: string;
}

/**
 * Send one notification to every live device a user has.
 *
 * Order matters. The receipt is inserted FIRST, and a unique-violation on it is
 * the dedupe: two concurrent detectors racing on the same cover flip both try
 * to insert, one loses, and only the winner sends. Doing it the other way round
 * — send, then record — double-notifies on the race and on any crash between
 * the two.
 */
export async function sendToUser(
  db: SupabaseClient,
  userId: string,
  kind: NotificationKind,
  subject: string,
  payload: PushPayload,
): Promise<SendResult> {
  // An explicit preference always wins. With no row, the kind's own default
  // decides — which is how bad beats ship silent until someone asks for them.
  const { data: pref } = await db
    .from("notification_prefs")
    .select("enabled")
    .eq("user_id", userId)
    .eq("kind", kind)
    .maybeSingle();
  let wanted = pref?.enabled;
  if (wanted === undefined || wanted === null) {
    const { data: setting } = await db
      .from("notification_settings")
      .select("default_enabled")
      .eq("kind", kind)
      .maybeSingle();
    wanted = setting?.default_enabled ?? true;
  }
  if (!wanted) return { sent: 0, duplicate: false, pruned: 0, reason: "opted out" };

  const { error: receiptErr } = await db.from("notification_sends").insert({
    user_id: userId,
    kind,
    subject,
    title: payload.title,
    body: payload.body,
    url: payload.url ?? null,
    status: "sent",
  });
  // 23505 = unique_violation: this person has already been told this thing.
  if (receiptErr?.code === "23505") {
    return { sent: 0, duplicate: true, pruned: 0, reason: "already sent" };
  }
  if (receiptErr) throw new Error(`notification_sends insert: ${receiptErr.message}`);

  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)
    .is("disabled_at", null);

  const devices = (subs ?? []) as Subscription[];
  if (devices.length === 0) {
    await db
      .from("notification_sends")
      .update({ status: "skipped", detail: "no devices" })
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("subject", subject);
    return { sent: 0, duplicate: false, pruned: 0, reason: "no devices" };
  }

  configure();
  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;
  const errors: string[] = [];

  for (const device of devices) {
    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        body,
        { TTL: 60 * 60 * 6 },
      );
      sent++;
    } catch (err) {
      const status = err instanceof WebPushError ? err.statusCode : 0;
      // 404/410 is the push service saying this device is gone for good — the
      // app was deleted, or iOS rotated the subscription. Retiring it here is
      // what stops a dead endpoint being retried every Saturday forever.
      if (status === 404 || status === 410) {
        await db
          .from("push_subscriptions")
          .update({ disabled_at: new Date().toISOString() })
          .eq("id", device.id);
        pruned++;
      } else {
        await db
          .from("push_subscriptions")
          .update({ failure_count: 1 })
          .eq("id", device.id)
          .select();
        errors.push(`${status || "err"}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (sent === 0) {
    await db
      .from("notification_sends")
      .update({
        status: "failed",
        detail: errors.join("; ").slice(0, 500) || `all ${devices.length} devices gone`,
      })
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("subject", subject);
  } else if (errors.length) {
    await db
      .from("notification_sends")
      .update({ detail: errors.join("; ").slice(0, 500) })
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("subject", subject);
  }

  return { sent, duplicate: false, pruned, reason: errors[0] };
}

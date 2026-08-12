"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";
import { type NotificationKind, fill, pushConfigured, sendToUser } from "../../lib/push";

export interface PushResult {
  ok: boolean;
  message?: string;
}

/** The signed-in user, or null. */
async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** The signed-in user, but only if they are an admin. */
async function currentAdmin() {
  const user = await currentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return data?.is_admin ? user : null;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Store a device, or refresh the one already stored.
 *
 * Called on opt-in and again on every launch: the endpoint is the primary key
 * from the browser's side, so re-subscribing the same browser upserts rather
 * than duplicating, and `last_seen_at` is what tells a stale row from a live
 * one months later.
 */
export async function saveSubscription(
  sub: SubscriptionInput,
  userAgent?: string,
): Promise<PushResult> {
  const user = await currentUser();
  if (!user) return { ok: false, message: "Not signed in" };
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { ok: false, message: "That subscription is missing its keys" };
  }

  const service = createServiceClient();
  const { error } = await service.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: userAgent?.slice(0, 300) ?? null,
      last_seen_at: new Date().toISOString(),
      // A device that was retired and has come back is live again.
      disabled_at: null,
      failure_count: 0,
    },
    { onConflict: "endpoint" },
  );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** Forget a device. Used when the switch is turned off. */
export async function removeSubscription(endpoint: string): Promise<PushResult> {
  const user = await currentUser();
  if (!user) return { ok: false, message: "Not signed in" };
  const service = createServiceClient();
  await service
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", user.id);
  return { ok: true };
}

/**
 * Send yourself one notification.
 *
 * The subject carries a timestamp so the dedupe key never collides — a test you
 * cannot repeat is not much of a test.
 */
export async function sendTestNotification(): Promise<PushResult> {
  const user = await currentUser();
  if (!user) return { ok: false, message: "Not signed in" };
  if (!pushConfigured()) return { ok: false, message: "Push keys are not configured on the server" };

  const service = createServiceClient();
  const result = await sendToUser(service, user.id, "admin", `test:${Date.now()}`, {
    title: "The CFB Slate",
    body: "Notifications are working. This is what a real one will look like.",
    url: "/me",
  });
  if (result.sent === 0) {
    return { ok: false, message: result.reason ?? "Nothing was delivered" };
  }
  return { ok: true, message: `Sent to ${result.sent} device${result.sent === 1 ? "" : "s"}` };
}

/** Turn one kind on or off for yourself. */
export async function setNotificationPref(
  kind: NotificationKind,
  enabled: boolean,
): Promise<PushResult> {
  const user = await currentUser();
  if (!user) return { ok: false, message: "Not signed in" };
  const service = createServiceClient();
  const { error } = await service
    .from("notification_prefs")
    .upsert({ user_id: user.id, kind, enabled }, { onConflict: "user_id,kind" });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/* ---- admin ------------------------------------------------------------- */

/**
 * Compose and send an ad-hoc notification.
 *
 * The whole point of PUSH-7: an announcement should never need a deploy.
 * Audience is the owner, one group, or everyone with a live device.
 */
export async function sendAdHocNotification(formData: FormData): Promise<PushResult> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, message: "Commissioner only" };
  if (!pushConfigured()) return { ok: false, message: "Push keys are not configured on the server" };

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim() || "/";
  const audience = String(formData.get("audience") ?? "me");
  if (!title) return { ok: false, message: "A notification needs a title" };

  const service = createServiceClient();
  let userIds: string[];
  if (audience === "me") {
    userIds = [admin.id];
  } else if (audience === "everyone") {
    const { data } = await service
      .from("push_subscriptions")
      .select("user_id")
      .is("disabled_at", null);
    userIds = [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))];
  } else {
    // audience is a group id
    const { data } = await service
      .from("group_members")
      .select("user_id")
      .eq("group_id", Number(audience));
    userIds = [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))];
  }

  if (userIds.length === 0) return { ok: false, message: "Nobody in that audience has a device" };

  // One subject for the whole blast, so the receipt reads as one announcement
  // rather than N unrelated rows.
  const subject = `adhoc:${Date.now()}`;
  let sent = 0;
  for (const id of userIds) {
    const result = await sendToUser(service, id, "admin", subject, { title, body, url });
    sent += result.sent;
  }

  revalidatePath("/admin");
  return {
    ok: sent > 0,
    message:
      sent > 0
        ? `Sent to ${sent} device${sent === 1 ? "" : "s"} across ${userIds.length} ${userIds.length === 1 ? "person" : "people"}`
        : "Nothing was delivered — nobody in that audience has a live device",
  };
}

/**
 * Retune a trigger without a deploy: on/off, how far ahead it fires, and the
 * copy. Templates take `{{token}}` placeholders — see src/lib/push.ts.
 */
export async function updateNotificationSetting(formData: FormData): Promise<PushResult> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, message: "Commissioner only" };

  const kind = String(formData.get("kind") ?? "") as NotificationKind;
  if (!["picks_due", "bad_beat", "log_bets", "admin"].includes(kind)) {
    return { ok: false, message: "Unknown notification kind" };
  }
  const lead = Number(formData.get("lead_minutes") ?? 0);
  if (!Number.isFinite(lead) || lead < 0 || lead > 1440) {
    return { ok: false, message: "Lead time must be between 0 and 1440 minutes" };
  }

  const service = createServiceClient();
  const { error } = await service
    .from("notification_settings")
    .update({
      enabled: formData.get("enabled") === "on",
      lead_minutes: Math.round(lead),
      title: String(formData.get("title") ?? "").slice(0, 120),
      body: String(formData.get("body") ?? "").slice(0, 300),
      updated_at: new Date().toISOString(),
    })
    .eq("kind", kind);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  return { ok: true, message: "Saved" };
}

/** Preview what a template renders to, so copy can be checked before it fires. */
export async function previewTemplate(
  template: string,
  values: Record<string, string>,
): Promise<string> {
  return fill(template, values);
}

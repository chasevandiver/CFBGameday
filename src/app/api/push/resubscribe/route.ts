import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createServiceClient } from "../../../../lib/supabase/service";

/**
 * Where the service worker posts a rotated subscription.
 *
 * `pushsubscriptionchange` fires in the worker, which cannot call a server
 * action — hence a route. Same-origin fetches from a worker carry cookies, so
 * this authenticates as the signed-in user with no token plumbing.
 *
 * This is the half of re-subscription that works while the app is closed. The
 * client also re-syncs on launch; between them a rotated endpoint is repaired
 * either immediately or the next time the app is opened, rather than silently
 * never.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let payload: {
    old?: string | null;
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const sub = payload.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ ok: false, error: "incomplete subscription" }, { status: 400 });
  }

  const service = createServiceClient();
  // Drop the endpoint the browser just retired, scoped to this user so a stray
  // post cannot delete someone else's device.
  if (payload.old) {
    await service
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", payload.old)
      .eq("user_id", user.id);
  }

  const { error } = await service.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      last_seen_at: new Date().toISOString(),
      disabled_at: null,
      failure_count: 0,
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

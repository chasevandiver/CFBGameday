"use client";

import { BellRing, Share } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  removeSubscription,
  saveSubscription,
  sendTestNotification,
  setNotificationPref,
} from "../app/actions/push";
import type { NotificationKind } from "../lib/push";

/**
 * The notification opt-in (docs/STATUS.md PUSH-2).
 *
 * Three shapes, and which one you see is decided by the platform, not by
 * preference:
 *
 *  - **iOS, not installed** — instructions, no switch. Safari on iOS refuses
 *    `Notification.requestPermission()` outside a home-screen app, and there is
 *    no `beforeinstallprompt` to automate the install, so telling the user to
 *    tap Share is genuinely the only lever available.
 *  - **Unsupported** — a plain sentence. No dead switch to poke at.
 *  - **Supported** — the switch, per-kind toggles, and a test button.
 *
 * The permission request is on a click handler for the same reason: iOS drops
 * it silently when it is not driven by a gesture, which looks like a bug in the
 * app rather than a policy.
 */

const KINDS: { kind: NotificationKind; label: string; hint: string }[] = [
  { kind: "picks_due", label: "Picks closing", hint: "Once, before the week's first kickoff" },
  { kind: "bad_beat", label: "Bad beats", hint: "When a game you have a side on flips late" },
];

type Stage = "checking" | "unsupported" | "needs-install" | "off" | "on";

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Installed to the Home Screen — the gate iOS puts in front of Web Push. */
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS predates the standard and still reports it here.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** VAPID public keys travel base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushSettings({ prefs }: { prefs: Record<string, boolean> }) {
  const [stage, setStage] = useState<Stage>("checking");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [kindState, setKindState] = useState(prefs);

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !publicKey) {
        // iOS shows this before install too, because PushManager only exists
        // in a home-screen app — so check the install case first.
        if (alive) setStage(isIos() && !isStandalone() ? "needs-install" : "unsupported");
        return;
      }
      if (isIos() && !isStandalone()) {
        if (alive) setStage("needs-install");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      if (!alive) return;
      if (existing) {
        // Re-sync on every launch: this is what repairs an endpoint the browser
        // rotated while the app was closed, and what keeps last_seen_at honest.
        await saveSubscription(existing.toJSON() as never, navigator.userAgent);
        setStage("on");
      } else {
        setStage("off");
      }
    })().catch(() => alive && setStage("unsupported"));
    return () => {
      alive = false;
    };
  }, [publicKey]);

  const enable = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNote(
          permission === "denied"
            ? "Blocked. iOS only asks once — turn it back on in Settings › Notifications."
            : "Not enabled.",
        );
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const sub = await registration.pushManager.subscribe({
        // Mandatory on iOS, and honest anyway: there is no silent-push path.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey!),
      });
      const result = await saveSubscription(sub.toJSON() as never, navigator.userAgent);
      if (!result.ok) {
        setNote(result.message ?? "Could not save this device");
        return;
      }
      setStage("on");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not turn notifications on");
    } finally {
      setBusy(false);
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const sub = await registration?.pushManager.getSubscription();
      if (sub) {
        await removeSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setStage("off");
      setNote(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    setBusy(true);
    setNote(null);
    const result = await sendTestNotification();
    setNote(result.message ?? (result.ok ? "Sent" : "Failed"));
    setBusy(false);
  }, []);

  const toggleKind = useCallback(async (kind: NotificationKind, enabled: boolean) => {
    setKindState((s) => ({ ...s, [kind]: enabled }));
    await setNotificationPref(kind, enabled);
  }, []);

  if (stage === "checking") return null;

  return (
    <section className="card mt-6 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm text-accent">
        <BellRing size={14} aria-hidden />
        Notifications
      </h2>

      {stage === "unsupported" && (
        <p className="text-xs text-dim">
          This browser can&rsquo;t do push notifications. Chrome, Firefox, and an installed app on
          iOS 16.4 or later all can.
        </p>
      )}

      {stage === "needs-install" && (
        <div className="text-xs leading-relaxed text-dim">
          <p>
            iOS only sends notifications to an app on your Home Screen — not to a Safari tab.
            There&rsquo;s no way for the site to do this for you.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-chalk">
            Tap <Share size={13} aria-hidden className="text-accent" /> then{" "}
            <span className="font-semibold">Add to Home Screen</span>, open it from there, and this
            turns into a switch.
          </p>
        </div>
      )}

      {(stage === "off" || stage === "on") && (
        <>
          <p className="text-xs text-dim">
            {stage === "on"
              ? "On for this device. Each device is separate."
              : "Off. Two a week at most — nothing about line moves."}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={stage === "on" ? disable : enable}
              disabled={busy}
              className="min-h-11 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {stage === "on" ? "Turn off on this device" : "Turn on"}
            </button>
            {stage === "on" && (
              <button
                onClick={test}
                disabled={busy}
                className="min-h-11 rounded-lg border border-chalk/15 px-3 text-sm font-medium text-chalk transition-colors hover:border-chalk/30 disabled:opacity-50"
              >
                Send a test
              </button>
            )}
          </div>

          {stage === "on" && (
            <ul className="mt-4 space-y-2 border-t border-chalk/10 pt-3">
              {KINDS.map(({ kind, label, hint }) => (
                <li key={kind} className="flex items-center justify-between gap-3">
                  <span className="text-xs">
                    <span className="text-chalk">{label}</span>
                    <span className="block text-dim">{hint}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={kindState[kind] !== false}
                    onChange={(e) => toggleKind(kind, e.target.checked)}
                    aria-label={label}
                    className="size-5 shrink-0 accent-[var(--accent)]"
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {note && <p className="mt-3 text-xs text-dim">{note}</p>}
    </section>
  );
}

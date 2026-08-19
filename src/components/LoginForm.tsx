"use client";

import { useState } from "react";
import type { AuthError } from "@supabase/supabase-js";
import { createClient } from "../lib/supabase/client";

/**
 * Sign-in, and the one thing it has to get right: saying why it failed.
 *
 * ## The red `{}`
 *
 * Reported 2026-08-15 — a brand-new address produced a bare red `{}` under the
 * form and nothing else. That is not our string; it comes out of `auth-js`.
 * `handleError` treats every 5xx as retryable and builds the message with
 * `_getErrorMessage(response)` — passing the **`Response` object**, not its
 * parsed body (`@supabase/auth-js/dist/main/lib/fetch.js:34-42`). `Response`
 * has no own enumerable properties, so `JSON.stringify` of it is literally
 * `"{}"`, and `error.message` is that. Any 500 from GoTrue therefore reaches
 * the UI as `{}` with the real reason discarded.
 *
 * Two different failures reach the UI that way, and both are live here:
 *
 *   * **Invite-only.** `handle_new_user` (migration 0002) raises for an address
 *     that is not on `invite_allowlist`. The raise aborts the `auth.users`
 *     insert, GoTrue answers 500 `unexpected_failure`, and the raise message —
 *     which says exactly what is wrong — never leaves the database.
 *   * **SMTP.** A custom sender that can't authenticate fails the send, which
 *     is also a 500.
 *
 * ## What this does about it
 *
 * A brand-new address is identified *before* the signup path runs, by asking
 * for a sign-in with `shouldCreateUser: false`. An existing account gets its
 * link from that first call. Anything else comes back as a clean 422
 * `otp_disabled` — the one unambiguous "there is no account here" — and only
 * then do we run the call that can create one. So a 500 is attributable: on the
 * second call it is the signup, on the first it is not.
 *
 * The extra round trip costs no email: the probe only sends when the account
 * already exists, in which case that IS the link.
 */

const INVITE_ONLY =
  "This site is invite-only, and that address isn’t on the list yet — ask the commissioner to add it from the admin console.";

/** `otp_disabled` is GoTrue's answer to "sign this person in, don't create them". */
function isUnknownAccount(error: AuthError): boolean {
  return (
    error.code === "otp_disabled" ||
    /signups? not allowed/i.test(error.message) ||
    /user not found/i.test(error.message)
  );
}

/**
 * The sentence to put under the form.
 *
 * `signup` says which call failed, which is the whole reason for the two-step
 * above: on the signup call a 500 is the invite trigger or the mailer, and both
 * of those have an action attached. Everywhere else a 500 is just a 500.
 */
export function explainAuthError(error: AuthError, signup: boolean): string {
  const status = error.status ?? 0;
  const raw = (error.message ?? "").trim();

  if (error.code === "over_email_send_rate_limit" || status === 429) {
    return "Too many sign-in emails just now. Wait a minute and try again.";
  }
  if (/invite|not allowed|not authorized/i.test(raw)) return INVITE_ONLY;
  if (signup) {
    // Ambiguous by construction — GoTrue collapses the trigger's raise and a
    // failed send into the same opaque 500. Lead with the likely one, name the
    // other rather than leaving someone who WAS invited staring at a wall.
    return `${INVITE_ONLY} If you were already added, the sign-in email failed to send — try again in a minute.`;
  }
  if (status >= 500 || raw === "" || raw === "{}") {
    return "The sign-in service returned an error. Try again in a minute — if it keeps happening, tell the commissioner.";
  }
  return raw;
}

export function LoginForm({ linkFailed }: { linkFailed: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const emailRedirectTo = `${window.location.origin}/auth/confirm`;

    const fail = (error: AuthError, signup: boolean) => {
      setStatus("error");
      setMessage(explainAuthError(error, signup));
    };

    // 1. Existing account? This never creates one, so it can only fail in ways
    //    that are safe to report literally.
    const existing = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo, shouldCreateUser: false },
    });
    if (!existing.error) {
      setStatus("sent");
      return;
    }
    if (!isUnknownAccount(existing.error)) {
      fail(existing.error, false);
      return;
    }

    // 2. No account yet — this is the call the allowlist trigger can reject.
    const created = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });
    if (created.error) {
      fail(created.error, true);
      return;
    }
    setStatus("sent");
  }

  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <p className="stat text-sm tracking-[0.3em] text-accent uppercase">Game day, every day</p>
      <h1 className="text-4xl sm:text-5xl">The Slate</h1>
      {/* the login page had no way back to the public site (audit 08/UX-19) */}
      <div className="flex flex-col items-center gap-2">
        <a href="/slate" className="stat text-xs text-accent underline-offset-2 hover:underline">
          Browse this week&rsquo;s slate without signing in →
        </a>
        {/* Someone who followed a shared link and landed on a form has been
            sold nothing yet. This is the way back to the pitch. */}
        <a href="/welcome" className="stat text-xs text-dim underline-offset-2 hover:text-chalk">
          What is The Slate?
        </a>
      </div>

      {status === "sent" ? (
        <div className="max-w-sm rounded-lg border border-accent/40 bg-surface p-6">
          <p className="text-lg">Check your email 📬</p>
          <p className="mt-2 text-sm text-chalk/70">
            Tap the link and you&rsquo;re in — you won&rsquo;t need to log in again on this device.
          </p>
        </div>
      ) : (
        <form onSubmit={sendLink} className="flex w-full max-w-sm flex-col gap-3">
          {linkFailed && (
            <p className="rounded-lg border border-loss/50 bg-loss/10 p-2 text-sm text-loss">
              That link didn&rsquo;t work (it may have expired or already been used). Enter your
              email for a fresh one.
            </p>
          )}
          <p className="text-sm text-chalk/70">
            One-time sign-in. After this you stay logged in.
          </p>
          <input
            type="email"
            required
            autoComplete="email"
            spellCheck={false}
            aria-label="Email address"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-chalk/25 bg-elev px-4 py-3 text-chalk placeholder:text-chalk/40 focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-lg bg-accent px-4 py-3 font-semibold text-accent-ink disabled:opacity-60"
          >
            {status === "sending" ? "Sending…" : "Send my link"}
          </button>
          {/* aria-live: the failure is the only thing that changes on the page,
              and a screen reader otherwise sits on the button saying nothing. */}
          <p role="status" aria-live="polite" className="text-sm text-loss">
            {status === "error" ? message : ""}
          </p>
        </form>
      )}
    </main>
  );
}

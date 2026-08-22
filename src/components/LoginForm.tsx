"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

/**
 * The sentence for a six-digit code that did not verify.
 *
 * Separate from `explainAuthError` because the failures are different — a code
 * is wrong, stale or reused, none of which the link path can be — but it keeps
 * that function's one hard-won rule: **a 5xx must never reach the UI as its own
 * message.** `auth-js` builds a 5xx message with `JSON.stringify(Response)`, so
 * `error.message` is literally `"{}"` on `verifyOtp` exactly as it is on
 * `signInWithOtp`. Same bug, same guard.
 *
 * No expiry duration in the copy. It is a Supabase project setting, not
 * something this file knows, and a wrong number in an error message is worse
 * than no number.
 */
export function explainCodeError(error: AuthError): string {
  const status = error.status ?? 0;
  const raw = (error.message ?? "").trim();

  if (status === 429 || error.code === "over_request_rate_limit") {
    return "Too many tries just now. Wait a minute and try again.";
  }
  if (status >= 500 || raw === "" || raw === "{}") {
    return "The sign-in service returned an error. Try again in a minute — if it keeps happening, tell the commissioner.";
  }
  // Everything else from this endpoint is the same practical answer: the code
  // in the box is not the code the server is holding. GoTrue spells that
  // several ways (otp_expired, 403, "Token has expired or is invalid") and the
  // distinction does not change what the person should do next.
  return "That code didn’t work — it may have expired, or already been used. Send a new email and use the fresh code.";
}

export function LoginForm({ linkFailed }: { linkFailed: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [codeStatus, setCodeStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [codeMessage, setCodeMessage] = useState("");
  /* Which template GoTrue sent, and therefore what `verifyOtp` must be told.
     An existing account gets the Magic Link email and verifies as `email`; an
     account created by the second call below gets Confirm Signup and verifies
     as `signup`. Passing the wrong one fails a perfectly good code, so it is
     tracked at the moment the send succeeds rather than guessed at verify
     time. Both templates need `{{ .Token }}` for the code to exist at all. */
  const [otpType, setOtpType] = useState<"email" | "signup">("email");
  const codeRef = useRef<HTMLInputElement>(null);

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
      setOtpType("email");
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
    setOtpType("signup");
    setStatus("sent");
  }

  /**
   * The code path, and the reason it exists: an emailed link always opens in
   * the default browser, and on iOS a home-screen web app has its own cookie
   * jar. `createBrowserClient` uses PKCE, so the verifier written when the link
   * was requested inside the installed app is not there when Safari opens the
   * link — the exchange fails and `/auth/confirm` sends them to
   * `?error=link`. Typing the code never leaves the app, so none of that
   * applies. The link still works for anyone who prefers it.
   */
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    const token = code.trim();
    // The button stays enabled and this says why, rather than a greyed-out
    // control that explains nothing (Web Interface Guidelines: submit stays
    // enabled until the request starts).
    if (token.length < 6) {
      setCodeStatus("error");
      setCodeMessage("That’s not the whole code — it’s six digits.");
      codeRef.current?.focus();
      return;
    }
    setCodeStatus("verifying");
    setCodeMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: otpType });
    if (error) {
      setCodeStatus("error");
      setCodeMessage(explainCodeError(error));
      // Back in the box: the next thing they do is retype it.
      codeRef.current?.focus();
      return;
    }
    // `refresh` BEFORE `push`, and both: the browser client has just written
    // the session cookie, but every server component rendered before that is
    // still in the router cache and still thinks nobody is signed in. `refresh`
    // invalidates it; `push` then lands on a hub that knows who you are. The
    // link path gets this for free — `/auth/confirm` redirects server-side —
    // and this is the client-side equivalent.
    router.refresh();
    router.push("/");
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
        /* The sent state used to be a dead end that said "tap the link" and
           left. It is now where you finish signing in, because the code is the
           half that cannot be taken to another browser. */
        <form onSubmit={verifyCode} className="flex w-full max-w-sm flex-col gap-3">
          <div className="rounded-lg border border-accent/40 bg-surface p-6">
            <p className="text-lg">Check your email 📬</p>
            <p className="mt-2 text-sm text-chalk/70">
              Enter the 6-digit code below and you&rsquo;re in — you won&rsquo;t need to log in
              again on this device.
            </p>
          </div>
          <input
            ref={codeRef}
            type="text"
            required
            name="one-time-code"
            inputMode="numeric"
            /* The reason iOS offers the code above the keyboard instead of
               making anyone switch to Mail and back. */
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            spellCheck={false}
            aria-label="Six-digit code from the email"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="stat rounded-lg border border-chalk/25 bg-elev px-4 py-3 text-center text-2xl tracking-[0.4em] text-chalk placeholder:text-chalk/40 focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          />
          <button
            type="submit"
            disabled={codeStatus === "verifying"}
            className="rounded-lg bg-accent px-4 py-3 font-semibold text-accent-ink disabled:opacity-60"
          >
            {codeStatus === "verifying" ? "Signing you in…" : "Sign in"}
          </button>
          <p role="status" aria-live="polite" className="text-sm text-loss">
            {codeStatus === "error" ? codeMessage : ""}
          </p>
          <p className="text-sm text-chalk/70">
            The link in the same email works too — but it opens in Safari, so if you added The
            Slate to your home screen, use the code to stay in the app.
          </p>
          <button
            type="button"
            onClick={() => {
              setStatus("idle");
              setCode("");
              setCodeStatus("idle");
              setCodeMessage("");
            }}
            className="stat text-xs text-dim underline-offset-2 hover:text-chalk focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            Use a different email, or send a new code
          </button>
        </form>
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
            name="email"
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

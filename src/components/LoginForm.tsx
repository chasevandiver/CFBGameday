"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase/client";

export function LoginForm({ linkFailed }: { linkFailed: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) {
      setStatus("error");
      // Supabase phrases allowlist rejections as "Signups not allowed…"
      setMessage(
        /invite|signup|not allowed|not authorized/i.test(error.message)
          ? "This site is invite-only — ask the commissioner to add your email."
          : error.message,
      );
    } else {
      setStatus("sent");
    }
  }

  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <p className="stat text-sm tracking-[0.3em] text-accent uppercase">Game day, every day</p>
      <h1 className="text-4xl sm:text-5xl">The CFB Slate</h1>

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
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-chalk/25 bg-elev px-4 py-3 text-chalk placeholder:text-chalk/40 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-lg bg-accent px-4 py-3 font-semibold text-accent-ink disabled:opacity-60"
          >
            {status === "sending" ? "Sending…" : "Send my link"}
          </button>
          {status === "error" && <p className="text-sm text-loss">{message}</p>}
        </form>
      )}
    </main>
  );
}

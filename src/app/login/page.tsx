"use client";

import { useState } from "react";
import { createClient } from "../../lib/supabase/client";

export default function LoginPage() {
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
      setMessage(
        error.message.includes("invite")
          ? "This site is invite-only — ask the commissioner to add your email."
          : error.message,
      );
    } else {
      setStatus("sent");
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <p className="stat text-sm tracking-[0.3em] text-gold uppercase">2026 season</p>
      <h1 className="text-4xl sm:text-5xl">The CFB Slate</h1>

      {status === "sent" ? (
        <div className="max-w-sm rounded border border-gold/40 bg-surface p-6">
          <p className="text-lg">Check your email 📬</p>
          <p className="mt-2 text-sm text-chalk/70">
            Tap the link and you&rsquo;re in — you won&rsquo;t need to log in again on this device.
          </p>
        </div>
      ) : (
        <form onSubmit={sendLink} className="flex w-full max-w-sm flex-col gap-3">
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
            className="rounded border border-chalk/25 bg-field-deep px-4 py-3 text-chalk placeholder:text-chalk/40 focus:border-gold focus:outline-none"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded bg-gold px-4 py-3 font-semibold text-field-deep disabled:opacity-60"
          >
            {status === "sending" ? "Sending…" : "Send my link"}
          </button>
          {status === "error" && <p className="text-sm text-flag">{message}</p>}
        </form>
      )}
    </main>
  );
}

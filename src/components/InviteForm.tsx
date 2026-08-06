"use client";

import { useRef, useState, useTransition } from "react";
import { inviteCrewMember } from "../app/actions/invites";

export function InviteForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function submit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      setLink(null);
      setCopied(false);
      const res = await inviteCrewMember(formData);
      if (res.ok && res.link) {
        setLink(res.link);
        formRef.current?.reset();
      } else {
        setError(res.message ?? "Something went wrong");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <form ref={formRef} action={submit} className="flex gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="friend@example.com"
          className="flex-1 rounded-lg border border-chalk/25 bg-elev px-3 py-2 text-sm text-chalk placeholder:text-chalk/40 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
        >
          {pending ? "Minting…" : "Invite"}
        </button>
      </form>
      {link && (
        <div className="rounded-lg border border-accent/40 bg-elev p-3">
          <p className="mb-2 text-xs text-chalk/70">
            Text them this link — one tap signs them in for good on that device (expires in ~1
            hour; invite again to mint a fresh one):
          </p>
          <div className="flex items-center gap-2">
            <code className="stat flex-1 truncate text-xs text-accent">{link}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(link);
                setCopied(true);
              }}
              className="rounded-lg border border-chalk/25 px-2 py-1 text-xs text-chalk hover:border-accent"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-loss">{error}</p>}
    </div>
  );
}

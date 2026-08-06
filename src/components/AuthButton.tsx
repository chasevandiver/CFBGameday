"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";

/**
 * Session-aware nav button: signed-out visitors get "Sign in" (the site is
 * public to browse; an account saves picks and bets), members get a sign-out
 * control — previously the product had no way to sign out at all (audit).
 * Renders nothing until the session is known so neither state flashes.
 */
export function AuthButton() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (alive) setSignedIn(data.session !== null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (signedIn === null) return null;

  if (!signedIn) {
    return (
      <Link
        href="/login"
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
      >
        Sign in
      </Link>
    );
  }

  return (
    <button
      onClick={() => {
        void createClient()
          .auth.signOut()
          .then(() => {
            setSignedIn(false);
            router.push("/slate");
            router.refresh();
          });
      }}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-chalk/10 px-2.5 text-xs font-medium text-dim transition-colors hover:border-chalk/25 hover:text-chalk"
    >
      <LogOut size={13} aria-hidden />
      Sign out
    </button>
  );
}

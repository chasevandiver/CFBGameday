"use client";

import { ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isCurrentUserAdmin } from "../lib/admin";

/**
 * Session-aware nav button: signed-out visitors get "Sign in" (the site is
 * public to browse; an account saves picks and bets), members get Account, and
 * an admin gets Admin — the console is the page they actually want, and it was
 * previously reachable only from an 11px footnote at the bottom of /me.
 * Account settings live one link away at the top of /admin, so nothing is lost.
 *
 * Renders nothing until the session AND the role are known: resolving them
 * separately would flash "Account" before settling on "Admin".
 */
export function AuthButton() {
  const [state, setState] = useState<"loading" | "out" | "member" | "admin">("loading");
  useEffect(() => {
    let alive = true;
    const db = createClient();
    db.auth.getSession().then(async ({ data }) => {
      const id = data.session?.user.id;
      if (!id) {
        if (alive) setState("out");
        return;
      }
      // 0050 took is_admin off the authenticated column grant, so this asks
      // the definer function instead of reading the row. Nav chrome only —
      // every admin surface re-checks server-side.
      const admin = await isCurrentUserAdmin(db);
      if (alive) setState(admin ? "admin" : "member");
    });
    return () => {
      alive = false;
    };
  }, []);

  const signedIn = state === "member" || state === "admin";
  if (state === "loading") return null;

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

  const admin = state === "admin";
  return (
    <Link
      href={admin ? "/admin" : "/me"}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-chalk/10 px-2.5 text-xs font-medium text-dim transition-colors hover:border-chalk/25 hover:text-chalk"
    >
      {admin ? <ShieldCheck size={13} aria-hidden /> : <UserRound size={13} aria-hidden />}
      {admin ? "Admin" : "Account"}
    </Link>
  );
}

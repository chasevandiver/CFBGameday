"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";

/**
 * "Sign in" nav button, shown only to signed-out visitors. The site is public
 * to browse; an account is just for saving picks and logging bets. Renders
 * nothing until the session is known so members never see a sign-in flash.
 */
export function AuthButton() {
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

  if (signedIn !== false) return null;
  return (
    <Link
      href="/login"
      className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
    >
      Sign in
    </Link>
  );
}

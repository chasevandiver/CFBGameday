import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "../../../lib/supabase/server";

/**
 * Magic-link landing. Handles both link formats Supabase can send:
 *  - PKCE flow (default email template): ?code=...
 *  - token-hash template: ?token_hash=...&type=email
 * Either way: exchange for a session (cookies set by the server client),
 * then into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect("/slate");
  }

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) redirect("/slate");
  }

  redirect("/login?error=link");
}

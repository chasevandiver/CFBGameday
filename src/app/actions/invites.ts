"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createServiceClient } from "../../lib/supabase/service";
import { createClient } from "../../lib/supabase/server";

export interface InviteResult {
  ok: boolean;
  link?: string;
  message?: string;
}

/**
 * Admin-only crew invite: allowlist the email, create a confirmed account,
 * and mint a one-tap sign-in link to text them. No email delivery involved —
 * with never-expiring sessions, one working link is all anyone needs.
 */
export async function inviteCrewMember(formData: FormData): Promise<InviteResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: "That doesn't look like an email" };
  }

  // Caller must be a signed-in admin
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, message: "Commissioner only" };

  const service = createServiceClient();

  const { error: allowErr } = await service
    .from("invite_allowlist")
    .upsert({ email, invited_by: user.id });
  if (allowErr) return { ok: false, message: allowErr.message };

  // Create the account pre-confirmed (allowlist trigger runs on insert);
  // tolerate an already-existing account so links can be re-minted.
  const { error: createErr } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr && !/already/i.test(createErr.message)) {
    return { ok: false, message: createErr.message };
  }

  const { data, error: linkErr } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) return { ok: false, message: linkErr.message };

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "cfb-gameday.vercel.app";
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const link = `${proto}://${host}/auth/confirm?token_hash=${data.properties?.hashed_token}&type=magiclink`;

  revalidatePath("/crew");
  return { ok: true, link };
}

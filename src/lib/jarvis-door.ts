/**
 * The Jarvis door (JARVIS-1): one way in for the owner's home assistant.
 *
 * Owner request, 2026-11-19: "I don't want the picks for bets logged in
 * Jarvis, I want them in my app." Jarvis hears "Hayden is on Texas plus 4",
 * works out the game, and logs it here — the same row the bet form writes.
 *
 * ## What the door is, and what it is not
 *
 * It is NOT a second way to write to `bets`. Every request is carried out as
 * the owner, on an ordinary signed-in session, so the row meets the same
 * policy (`"insert own bets"`, 0083), the same grant (`can_log_bet_for`) and
 * the same sanitizer (`enforce_bet_insert_clean`, 0013) as one typed into the
 * site. A proxy row still needs the byline and still needs the owner to run
 * the member's betting group; `placed_at` is still the database's clock. The
 * door cannot do anything the owner could not do from the ledger, because as
 * far as the database can tell it IS the owner at the ledger.
 *
 * The service client appears exactly once, to mint that session
 * (`generateLink`, the call `actions/invites.ts` already makes), and never
 * touches a table. Doing the insert with it instead would have been shorter
 * and would have skipped all three checks above — the policy and the
 * sanitizer both key on the database role.
 *
 * ## Fails closed
 *
 * Two environment variables, both required. With either missing the routes
 * answer 404, as if they were not there: a deploy that has not been told
 * about Jarvis has no door. A wrong token is 401 and says nothing else.
 *
 *   JARVIS_DOOR_TOKEN    a long random secret, also saved on the Jarvis box
 *   JARVIS_DOOR_USER_ID  the owner's `profiles.id`
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isUuid } from "./log-for";
import { createServiceClient } from "./supabase/service";

/** Shorter than this is a typo or a placeholder, not a secret. */
const MIN_TOKEN_LENGTH = 32;

export interface DoorConfig {
  token: string;
  userId: string;
}

export function doorConfig(env: NodeJS.ProcessEnv = process.env): DoorConfig | null {
  const token = (env.JARVIS_DOOR_TOKEN ?? "").trim();
  const userId = (env.JARVIS_DOOR_USER_ID ?? "").trim();
  if (token.length < MIN_TOKEN_LENGTH || !isUuid(userId)) return null;
  return { token, userId };
}

/**
 * `Authorization: Bearer <token>`, compared in constant time. Hashing both
 * sides first is what makes the lengths equal — `timingSafeEqual` throws on a
 * length mismatch, and a comparison that only runs for right-length guesses
 * would leak the length.
 */
export function tokenMatches(header: string | null, token: string): boolean {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!match) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(match[1]), digest(token));
}

/**
 * What Jarvis may send. Narrower than the bet form on purpose: three markets
 * a person says out loud, each attached to a game. Futures, team totals and
 * first halves stay on the form, where there is a screen to check them on.
 *
 * `line` is the bettor's number, as spoken ("Texas +4" is `side` away or
 * home, `line` 4) — `storedLine` does the home-perspective flip, as it does
 * for the form.
 */
export const doorBetSchema = z
  .object({
    game_id: z.number().int().positive(),
    bet_type: z.enum(["spread", "moneyline", "total"]),
    side: z.enum(["home", "away", "over", "under"]),
    line: z.number().finite().nullable().optional(),
    odds: z.number().int().optional(),
    units: z.number().positive().max(50).optional(),
    for_user: z.string().optional(),
    description: z.string().trim().min(1).max(120),
  })
  .superRefine((b, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const line = b.line ?? null;
    const teamSide = b.side === "home" || b.side === "away";
    if (b.bet_type === "total") {
      if (teamSide) issue("A total is over or under");
      if (line === null || line <= 0 || line > 400) issue("A total needs its number");
    } else {
      if (!teamSide) issue("Pick a team");
      if (b.bet_type === "spread" && (line === null || Math.abs(line) > 100)) {
        issue("A spread needs its number");
      }
      if (b.bet_type === "moneyline" && line !== null) issue("A moneyline has no number");
    }
    if (line !== null && !Number.isInteger(line * 2)) issue("Lines move in half points");
    if (b.odds !== undefined && (Math.abs(b.odds) < 100 || Math.abs(b.odds) > 100000)) {
      issue("Bad odds");
    }
    if (b.for_user !== undefined && !isUuid(b.for_user)) issue("Bad person");
  });

export type DoorBet = z.infer<typeof doorBetSchema>;

export const doorVoidSchema = z.object({
  id: z.number().int().positive(),
  for_user: z
    .string()
    .refine(isUuid, { message: "Bad person" })
    .optional(),
});

/** First problem only, as a sentence — Jarvis shows it to the owner as is. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Bad request";
}

/**
 * A database client signed in as the owner.
 *
 * A session is minted with the service client and then used on a plain anon
 * client, so every query after this line runs as `authenticated` with the
 * owner's `auth.uid()`. The access token is kept for its lifetime in module
 * memory: a warm function reuses it, a cold one mints another. Nothing is
 * persisted, and nothing about the session is returned to the caller.
 */
let cached: { userId: string; accessToken: string; expiresAt: number } | null = null;

export async function ownerClient(userId: string): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const as = (accessToken: string) =>
    createSupabaseClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.userId === userId && cached.expiresAt - 120 > now) {
    return as(cached.accessToken);
  }

  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch {
    return null;
  }
  const { data: found, error: findErr } = await service.auth.admin.getUserById(userId);
  const email = found?.user?.email;
  if (findErr || !email) return null;
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return null;

  const fresh = createSupabaseClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signedIn, error: otpErr } = await fresh.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  const session = signedIn?.session;
  // The link was for one address; a session for anyone else is not the owner.
  if (otpErr || !session || session.user?.id !== userId) return null;

  cached = {
    userId,
    accessToken: session.access_token,
    expiresAt: session.expires_at ?? now + 300,
  };
  return as(session.access_token);
}

export type Door =
  | { ok: true; supabase: SupabaseClient; ownerId: string }
  | { ok: false; status: 401 | 404 | 502; error: string };

/** Config, then token, then the owner's session — in that order, and nothing before the token. */
export async function openDoor(authorization: string | null): Promise<Door> {
  const config = doorConfig();
  if (!config) return { ok: false, status: 404, error: "Not found" };
  if (!tokenMatches(authorization, config.token)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const supabase = await ownerClient(config.userId);
  if (!supabase) return { ok: false, status: 502, error: "Could not sign in as the owner" };
  return { ok: true, supabase, ownerId: config.userId };
}

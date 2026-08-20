/**
 * POST /api/share-card → a 1080×1350 PNG of the caller's bets.
 *
 * POST rather than a GET with search params for one decisive reason: the bet
 * slip shares selections that do not exist in the database yet. One route, one
 * code path, and the ledger and group surfaces use it unchanged.
 *
 * Node runtime, not edge — the fonts are read from disk and the session comes
 * from the server Supabase client, the same reason `/game/[id]`'s card omits
 * the edge export.
 */

import { ImageResponse } from "next/og";
import { z } from "zod";
import { CONFIDENCE_TIERS } from "../../../lib/db-types";
import { DEFAULT_TZ } from "../../../lib/kick";
import {
  MAX_CARD_BETS,
  buildCardModel,
  type ShareCardBet,
  type ShareCardPayload,
} from "../../../lib/share-card";
import { resolveLogos, shareCardFonts } from "../../../lib/share-card-assets";
import { createClient } from "../../../lib/supabase/server";
import { CARD_HEIGHT, CARD_WIDTH, ShareCard } from "./card";
import { WrappedShareCard } from "./wrapped-card";

export const dynamic = "force-dynamic";

/**
 * Lengths are bounded because the layout is fixed: a 400-character "pick" does
 * not overflow into a scrollbar, it wraps until the card is unreadable. These
 * are the widest strings the real data produces, with room to spare — the
 * longest matchup the product can build is "Miami (OH) at Western Michigan".
 */
const TeamSchema = z.object({
  abbr: z.string().max(8),
  logo: z.string().max(300).nullable(),
  color: z.string().max(9).nullable(),
});

const iso = z
  .string()
  .max(40)
  .refine((s) => Number.isFinite(Date.parse(s)), "not a date");

const BetSchema = z.object({
  key: z.string().max(64),
  tier: z.enum(CONFIDENCE_TIERS),
  pick: z.string().min(1).max(64),
  matchup: z.string().max(80),
  away: TeamSchema.nullable(),
  home: TeamSchema.nullable(),
  units: z.number().finite().min(0).max(9999),
  odds: z.number().int().min(-100000).max(100000),
  kickTs: iso.nullable(),
  league: z.enum(["cfb", "nfl"]).optional(),
});

const PayloadSchema = z.object({
  title: z.string().min(1).max(48),
  subtitle: z.string().max(48),
  bets: z.array(BetSchema).min(1).max(MAX_CARD_BETS),
  overflow: z.number().int().min(0).max(999).default(0),
  tz: z.string().max(64).optional(),
});

/* R5-C: the Wrapped story card. A second payload kind on the same route —
   same auth gate, same fonts, same canvas — discriminated by `kind` so the
   original bets payload (which carries no kind) parses exactly as before. */
const WrappedSchema = z.object({
  kind: z.literal("wrapped"),
  year: z.number().int().min(2020).max(2100),
  eyebrow: z.string().min(1).max(40),
  headline: z.string().min(1).max(48),
  detail: z.string().max(160).nullable().default(null),
  sub: z.string().max(120).nullable().default(null),
});

const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function POST(req: Request): Promise<Response> {
  // Rendering is real compute, so it is not an open endpoint. The card only
  // ever contains what the caller already sent, so this is a cost gate rather
  // than an authorisation one — but an unauthenticated image renderer is a
  // free CPU faucet.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "Sign in to share");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Bad request body");
  }

  // The wrapped branch first: it names its kind; the bets payload never has one.
  if (typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === "wrapped") {
    const wrapped = WrappedSchema.safeParse(body);
    if (!wrapped.success) return fail(400, wrapped.error.issues[0]?.message ?? "Bad payload");
    let wrappedFonts: Awaited<ReturnType<typeof shareCardFonts>>;
    try {
      wrappedFonts = await shareCardFonts();
    } catch (err) {
      console.error("share-card assets failed", err);
      return fail(500, "Could not draw the card");
    }
    return new ImageResponse(<WrappedShareCard model={wrapped.data} />, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts: wrappedFonts,
      headers: { "cache-control": "no-store" },
    });
  }

  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Bad payload");
  const { tz, ...rest } = parsed.data;
  const payload: ShareCardPayload = rest;

  // Fonts and logos in parallel: the fonts are a warm module-scope read after
  // the first request, and the logos are the only network on this path. Only
  // the awaits are guarded — ImageResponse renders lazily as its stream is
  // consumed, so wrapping the JSX in this try would catch nothing and only
  // look like it did.
  let fonts: Awaited<ReturnType<typeof shareCardFonts>>;
  let logos: Awaited<ReturnType<typeof resolveLogos>>;
  try {
    [fonts, logos] = await Promise.all([
      shareCardFonts(),
      resolveLogos(
        payload.bets.flatMap((b: ShareCardBet) => [b.away?.logo ?? null, b.home?.logo ?? null]),
      ),
    ]);
  } catch (err) {
    // Missing fonts are the realistic failure here, and they are a deploy
    // problem: `npm run brand` writes public/fonts and they are committed.
    console.error("share-card assets failed", err);
    return fail(500, "Could not draw the card");
  }

  const model = buildCardModel(payload, tz || DEFAULT_TZ);

  return new ImageResponse(<ShareCard model={model} logos={logos} />, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts,
    headers: {
      // The card is a function of the request body, and that body is a live
      // slip. Nothing here should be cached by a CDN on the way back.
      "cache-control": "no-store",
    },
  });
}

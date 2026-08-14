/**
 * The two things the share-card route needs from outside itself: the brand
 * fonts, and team logos it can actually draw.
 *
 * Node runtime only — this reads from disk. The route omits `runtime = "edge"`
 * for exactly that reason, the same way `/game/[id]/opengraph-image.tsx` does
 * for its Supabase client.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface CardFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 700;
  style: "normal";
}

/**
 * BRAND.md §12's three roles, in the four faces the card actually sets.
 *
 * `next/og` takes font buffers and reads no CSS, so the faces the app loads
 * through `next/font` are unreachable from a route handler — which is why the
 * three OG cards that already exist render in a default sans. `npm run brand`
 * writes these files; they are committed, so a request never fetches a font.
 *
 * The `name` values are what the JSX asks for in `fontFamily`. satori matches
 * on that string and will not synthesise a weight it was not given.
 */
const FONT_FILES: Array<{ name: string; file: string; weight: 400 | 500 | 700 }> = [
  { name: "Graduate", file: "Graduate-Regular.ttf", weight: 400 },
  { name: "Archivo", file: "Archivo-Regular.ttf", weight: 400 },
  { name: "Archivo", file: "Archivo-Bold.ttf", weight: 700 },
  { name: "PlexMono", file: "IBMPlexMono-Medium.ttf", weight: 500 },
];

let fontsPromise: Promise<CardFont[]> | null = null;

/**
 * Read once per process, not once per request. The files do not depend on
 * request data, so this is the module-scope read the ImageResponse docs ask
 * for, deferred behind a promise so an import never does I/O.
 */
export function shareCardFonts(): Promise<CardFont[]> {
  fontsPromise ??= Promise.all(
    FONT_FILES.map(async (f) => {
      const buf = await readFile(join(process.cwd(), "public", "fonts", f.file));
      return {
        name: f.name,
        // A Buffer is a view into a pooled ArrayBuffer, so hand over a copy of
        // just this font's bytes rather than the whole pool.
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        weight: f.weight,
        style: "normal" as const,
      };
    }),
  );
  return fontsPromise;
}

/**
 * Logo hosts the route will fetch from.
 *
 * The payload is client-supplied, and satori would happily fetch whatever URL
 * it is handed — server-side, from inside the deployment. That is an SSRF, and
 * an image route is a comfortable place to hide one: the response is a picture,
 * so a probe of an internal address fails silently and looks like a broken
 * logo. So the fetch happens here, ahead of render, against an allowlist.
 *
 * Every logo in the database comes from ESPN's CDN — CFBD serves ESPN college
 * URLs (`scripts/sync-reference.ts`) and the NFL ingest reads them straight off
 * ESPN (`src/lib/espn.ts`). Anything else degrades to the monogram rather than
 * being fetched.
 */
const LOGO_HOSTS = [".espncdn.com", ".espn.com"];

export function isAllowedLogoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return LOGO_HOSTS.some((h) => u.hostname === h.slice(1) || u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

/** A logo bigger than this is not a logo, and is not worth inlining. */
const MAX_LOGO_BYTES = 512 * 1024;

/**
 * Fetch one logo and inline it.
 *
 * Returns null for anything that fails, and null is a normal outcome, not an
 * error: the card falls back to the coloured monogram `TeamMark` already shows
 * on screen for a broken logo. A share that renders without one team's crest is
 * worth far more than a 500.
 */
async function fetchLogo(url: string | null, timeoutMs: number): Promise<string | null> {
  if (!url || !isAllowedLogoUrl(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/png";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_LOGO_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Every logo on the card, resolved before a single pixel is drawn.
 *
 * satori can fetch a remote `<img>` itself, but then a slow CDN stalls the
 * render with no timeout of its own and no way to fall back. Fetching up front
 * means the layout is handed data URIs and a null, and both are just values.
 * Deduplicated because a team can appear on more than one row.
 */
export async function resolveLogos(
  urls: Array<string | null>,
  timeoutMs = 2500,
): Promise<Map<string, string>> {
  const unique = [...new Set(urls.filter((u): u is string => !!u))];
  const settled = await Promise.all(unique.map((u) => fetchLogo(u, timeoutMs)));
  const out = new Map<string, string>();
  unique.forEach((u, i) => {
    const data = settled[i];
    if (data) out.set(u, data);
  });
  return out;
}

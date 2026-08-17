/**
 * Where-to-watch (R2-A5): network → the app/service that actually carries it.
 *
 * `games.tv` stores the broadcast network as free text from two feeds (CFBD
 * media, ESPN broadcasts). "Which streaming service has this game" is the
 * question no official source answers; this table answers it for the networks
 * that appear in those feeds. Editorial data, maintained by hand — there is
 * no API for it, same posture as the NFL division table (scripts/lib/nfl.ts).
 *
 * An unmapped network renders as the network alone, never "unknown" — a wrong
 * or missing mapping must degrade to exactly what the card showed before this
 * feature existed.
 */

export interface WatchOn {
  /** The app/service to open. */
  app: string;
}

/** Keyed by normalized network name (see normalizeNetwork). */
const WATCH_ON: Record<string, WatchOn> = {
  ESPN: { app: "ESPN app" },
  ESPN2: { app: "ESPN app" },
  ESPNU: { app: "ESPN app" },
  ESPNEWS: { app: "ESPN app" },
  "ESPN+": { app: "ESPN app" },
  SECN: { app: "ESPN app" },
  ACCN: { app: "ESPN app" },
  ABC: { app: "ESPN app" },
  FOX: { app: "Fox Sports app" },
  FS1: { app: "Fox Sports app" },
  FS2: { app: "Fox Sports app" },
  BTN: { app: "Fox Sports app" },
  CBS: { app: "Paramount+" },
  CBSSN: { app: "Paramount+" },
  NBC: { app: "Peacock" },
  PEACOCK: { app: "Peacock" },
  NFLN: { app: "NFL+" },
  PRIME: { app: "Prime Video" },
  CW: { app: "The CW app" },
  TNT: { app: "Max" },
  TRUTV: { app: "Max" },
};

/** Aliases the feeds actually emit, folded onto the keys above. */
const ALIASES: Record<string, string> = {
  "SEC NETWORK": "SECN",
  "ACC NETWORK": "ACCN",
  "BIG TEN NETWORK": "BTN",
  "CBS SPORTS NETWORK": "CBSSN",
  "NFL NETWORK": "NFLN",
  "NFL NET": "NFLN",
  "PRIME VIDEO": "PRIME",
  "AMAZON PRIME": "PRIME",
  "AMAZON PRIME VIDEO": "PRIME",
  "THE CW": "CW",
  "CW NETWORK": "CW",
  "ESPN PLUS": "ESPN+",
};

export function normalizeNetwork(tv: string): string {
  const up = tv.trim().toUpperCase();
  return ALIASES[up] ?? up;
}

/** The service carrying a stored `games.tv` value, or null when unmapped. */
export function watchOn(tv: string | null | undefined): WatchOn | null {
  if (!tv) return null;
  return WATCH_ON[normalizeNetwork(tv)] ?? null;
}

/** "CBS · Paramount+", or just "CBS" when unmapped, or null with no network. */
export function watchLabel(tv: string | null | undefined): string | null {
  if (!tv) return null;
  const w = watchOn(tv);
  return w ? `${tv} · ${w.app}` : tv;
}

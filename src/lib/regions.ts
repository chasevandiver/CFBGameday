/**
 * US state → region, for Guess the Game's REGION chip.
 *
 * Census regions (Northeast / Midwest / South / West), not conference
 * footprints. A conference is not a region and has not been one for years —
 * the Big Ten reaches both coasts, the ACC holds a California school — so
 * deriving one from the other would produce a chip that lies about exactly
 * the realignments a college football fan notices first.
 *
 * The input is `venues.state`, which CFBD supplies as a two-letter code. DC is
 * folded into the South with Maryland and Virginia, which is where the Census
 * puts it. Anything unrecognised returns null and the chip stays undecided
 * rather than guessing — that path covers the handful of international venues
 * and any row where the state was never ingested.
 */

export type Region = "Northeast" | "Midwest" | "South" | "West";

const BY_STATE: Record<string, Region> = {
  CT: "Northeast", ME: "Northeast", MA: "Northeast", NH: "Northeast", RI: "Northeast",
  VT: "Northeast", NJ: "Northeast", NY: "Northeast", PA: "Northeast",

  IL: "Midwest", IN: "Midwest", MI: "Midwest", OH: "Midwest", WI: "Midwest",
  IA: "Midwest", KS: "Midwest", MN: "Midwest", MO: "Midwest", NE: "Midwest",
  ND: "Midwest", SD: "Midwest",

  DE: "South", DC: "South", FL: "South", GA: "South", MD: "South", NC: "South",
  SC: "South", VA: "South", WV: "South", AL: "South", KY: "South", MS: "South",
  TN: "South", AR: "South", LA: "South", OK: "South", TX: "South",

  AZ: "West", CO: "West", ID: "West", MT: "West", NV: "West", NM: "West",
  UT: "West", WY: "West", AK: "West", CA: "West", HI: "West", OR: "West",
  WA: "West",
};

/** The region a state sits in, or null for anything not recognised. */
export function regionOfState(state: string | null | undefined): Region | null {
  if (!state) return null;
  return BY_STATE[state.trim().toUpperCase()] ?? null;
}

/**
 * The region most of these states point at, or null if none do.
 *
 * A team's region comes from where its home games are played, and a school
 * with a neutral-site-heavy schedule or a stadium renovation year can have
 * home venues in two states. The mode is what settles it; a tie falls to the
 * first region seen, which is stable because the caller supplies venues in a
 * fixed order.
 */
export function modalRegion(states: Array<string | null | undefined>): Region | null {
  const counts = new Map<Region, number>();
  for (const s of states) {
    const r = regionOfState(s);
    if (r === null) continue;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  let best: Region | null = null;
  let bestN = 0;
  for (const [r, n] of counts) {
    if (n > bestN) {
      best = r;
      bestN = n;
    }
  }
  return best;
}

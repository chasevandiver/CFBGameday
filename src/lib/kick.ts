/**
 * Kickoff formatting in an arbitrary IANA timezone. The slate renders in the
 * crew's CT on the server, then re-renders in the viewer's browser timezone
 * after mount (no hydration mismatch, times just settle to local).
 */

export const DEFAULT_TZ = "America/Chicago";

/**
 * The zones a reader can pick on `/me` (UX-25).
 *
 * A curated list, not `Intl.supportedValuesOf("timeZone")`. That returns
 * ~400 entries, which is a worse control on a phone than a short list of the
 * zones college football is actually watched in, and it would ship the whole
 * table to the client for a setting most people never open.
 *
 * Hawaii and Alaska are here because the product has games in both (Stanford
 * at Hawai'i is on the Week 0 board). Arizona is separate from Mountain
 * because it does not observe DST, which is exactly the kind of thing a
 * fixed offset gets wrong for half the season.
 *
 * The list is the validation: `updateTimezone` refuses anything not in it, so
 * an arbitrary string can never reach `Intl.DateTimeFormat` and throw on a
 * page that merely wanted to print a kickoff.
 */
export const TIMEZONES = [
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Phoenix", label: "Arizona (no DST)" },
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
] as const;

export type TimezoneId = (typeof TIMEZONES)[number]["id"];

export function isSupportedTz(v: string | null | undefined): v is TimezoneId {
  return TIMEZONES.some((t) => t.id === v);
}

/** A stored preference when it is one we support, the house default otherwise. */
export function tzOf(stored: string | null | undefined): string {
  return isSupportedTz(stored) ? stored : DEFAULT_TZ;
}

export function kickParts(iso: string, tz: string): { day: string; time: string } {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return { day, time };
}

/**
 * "SAT 2:30 PM CT" — the heading a shared slip groups under. Plain text with
 * no punctuation to survive iMessage, and the day is carried because a slip
 * routinely spans Thursday through Saturday night.
 */
export function kickHeading(iso: string, tz: string): string {
  const { day, time } = kickParts(iso, tz);
  return `${day.toUpperCase()} ${time} ${tzLabel(tz)}`;
}

/**
 * "3:30p" — the kickoff in the width a betting sheet prints it.
 *
 * For the share card's number column, which is fixed-width so the stakes above
 * it register. "3:30 PM" is three characters too wide there and "3:30" alone is
 * ambiguous between an 11am and an 11pm kickoff. Same reasoning as the
 * lowercase totals in `GameCard`: unspaced and lowercase is how a book sets it,
 * and a lowercase meridiem never reads as part of the number.
 */
export function kickShort(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}${get("dayPeriod").toLowerCase().startsWith("p") ? "p" : "a"}`;
}

export function kickDateLong(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/** "CT", "ET", "PST"… whatever the browser calls it, shortened. */
export function tzLabel(tz: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  return (part ?? "").replace(/([A-Z])[SD]T$/, (m, first) =>
    m.length === 3 ? `${first}T` : m,
  );
}

/** Day key for the Thu/Fri/Sat tabs, in the viewer's tz. */
export function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function dayTabLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(
    new Date(iso),
  );
}

/**
 * Day-tab labels for a week, disambiguated only where they collide.
 *
 * Week 1 opens on a Saturday and closes on the Monday nine days later, so it
 * contains two of them — and a row reading "Sat · Thu · Fri · Sat · Sun · Mon"
 * gives you no way to tell which Saturday is which, or why a Saturday sorts
 * ahead of a Thursday. Championship week and the bowl slate have the same
 * shape.
 *
 * The date is added to *every* member of a colliding weekday and never to a
 * unique one: an ordinary week keeps its clean chips, and the week that needs
 * the help gets it on both sides of the ambiguity rather than on one.
 */
export function dayTabLabels(
  isos: string[],
  tz: string,
): Array<{ key: string; label: string }> {
  const byKey = new Map<string, string>();
  for (const iso of isos) {
    const k = dayKey(iso, tz);
    if (!byKey.has(k)) byKey.set(k, dayTabLabel(iso, tz));
  }
  const counts = new Map<string, number>();
  for (const w of byKey.values()) counts.set(w, (counts.get(w) ?? 0) + 1);

  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, w]) => {
      if ((counts.get(w) ?? 0) < 2) return { key, label: w };
      // "Sat 8/29" — the numeric date, which is how anybody reading a
      // schedule tells two of the same weekday apart.
      const [, m, d] = key.split("-");
      return { key, label: `${w} ${Number(m)}/${Number(d)}` };
    });
}

/** "12:41:07 PM" for the last-updated stamp. */
export function clockTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

/**
 * Broadcast kickoff slot, in the sport's shared (Eastern) vocabulary — the
 * Noon–Afternoon–Primetime–Late windows the whole country schedules around
 * (spec §7). Deliberately NOT viewer-local: "the noon slate" means the same
 * games in every timezone.
 */
export function kickSlot(iso: string): "Noon" | "Afternoon" | "Primetime" | "Late" {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(new Date(iso)),
  );
  if (h < 14) return "Noon";
  if (h < 18) return "Afternoon";
  if (h < 22) return "Primetime";
  return "Late";
}

/**
 * The NFL's broadcast vocabulary, same Eastern-clock reasoning as kickSlot:
 * "the early window" is the same games in every timezone. The section title
 * composes as "Sun · Early window", so the slot never repeats the day — the
 * day prefix is what makes "Thu · Primetime" read as TNF and "Mon ·
 * Primetime" as MNF without this function knowing the brands.
 */
export function nflKickSlot(iso: string): "Early window" | "Late window" | "Primetime" {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(new Date(iso)),
  );
  if (h < 15) return "Early window"; // the 1:00s (and London mornings)
  if (h < 19) return "Late window"; // the 4:05s and 4:25s
  return "Primetime"; // SNF / MNF / TNF by day prefix
}

export function periodLabel(period: number | null): string {
  if (period === null) return "";
  if (period <= 4) return `Q${period}`;
  return period === 5 ? "OT" : `${period - 4}OT`;
}

/**
 * Inside the two-minute warning window: Q2 or Q4 with the clock under 2:00 —
 * and still running. Hoisted from GameCard (which renders it as the `u2m`
 * treatment) so Fun Mode's pulse cadence can read the same fact instead of
 * re-parsing.
 *
 * `0:00` is excluded, added 2026-08-21. It is arithmetically under two minutes
 * and it is the opposite of the thing this marks: at Q2 0:00 the half is OVER,
 * and the card was wearing the tensest treatment it owns through the calmest
 * twelve minutes of the game. The urgency is about time REMAINING, and there
 * is none.
 */
export function underTwo(period: number | null, clock: string | null): boolean {
  if ((period !== 2 && period !== 4) || !clock) return false;
  if (isZeroClock(clock)) return false;
  const m = /^(\d+):\d\d$/.exec(clock.trim());
  return m !== null && Number(m[1]) < 2;
}

/** A clock that has run out — `0:00`, or `00:00` from a feed that pads. */
function isZeroClock(clock: string): boolean {
  return /^0+:00$/.test(clock.trim());
}

/**
 * The break a game is sitting in, or null when it is being played.
 *
 * Owner question, 2026-08-21: "is there anything stating halftime when a game
 * goes to half?" There was not. ESPN sends `STATUS_HALFTIME`, but the parser
 * reads only `type.state` ("in"), so halftime arrived as an ordinary live tick
 * and the card said `Q2 · 0:00` — true, and not the word anyone was looking
 * for. The same silence covered the gaps between quarters.
 *
 * Derived from the stored period and clock rather than captured from the feed,
 * deliberately. Capturing ESPN's status string would mean a column and a
 * change in both writers, and it would do nothing for CFB, where CFBD sends no
 * equivalent — while period 2 with an expired clock means halftime in both
 * leagues and in every feed that will ever back them.
 *
 * Callers render this INSTEAD of the period and clock: "HALFTIME" already says
 * everything `Q2 · 0:00` does, and says it in the language of the broadcast.
 */
export function breakLabel(period: number | null, clock: string | null): string | null {
  if (period === null || period < 1 || !clock || !isZeroClock(clock)) return null;
  // Q4 at 0:00 is a game going to overtime — it reads as END Q4 rather than
  // anything cleverer, because "the fourth quarter is over" is what happened
  // and the OT period appears on the next tick anyway.
  return period === 2 ? "HALFTIME" : `END ${periodLabel(period)}`;
}

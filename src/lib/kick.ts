/**
 * Kickoff formatting in an arbitrary IANA timezone. The slate renders in the
 * crew's CT on the server, then re-renders in the viewer's browser timezone
 * after mount (no hydration mismatch, times just settle to local).
 */

export const DEFAULT_TZ = "America/Chicago";

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

export function periodLabel(period: number | null): string {
  if (period === null) return "";
  if (period <= 4) return `Q${period}`;
  return period === 5 ? "OT" : `${period - 4}OT`;
}

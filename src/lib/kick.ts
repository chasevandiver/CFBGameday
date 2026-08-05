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

export function periodLabel(period: number | null): string {
  if (period === null) return "";
  if (period <= 4) return `Q${period}`;
  return period === 5 ? "OT" : `${period - 4}OT`;
}

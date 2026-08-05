/**
 * All kickoff times display in Central Time — the whole crew is CT.
 * One formatter used on server and client so there's no hydration mismatch.
 */

export const CREW_TZ = "America/Chicago";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CREW_TZ,
  hour: "numeric",
  minute: "2-digit",
});

const dayTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CREW_TZ,
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CREW_TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "11:00 AM" */
export function kickTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** "Sat 11:00 AM" */
export function kickDayTime(iso: string): string {
  return dayTimeFmt.format(new Date(iso));
}

/** "Sat, Aug 29" */
export function kickDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export type KickoffWindow = "Noon" | "Afternoon" | "Primetime" | "Late Night" | "Weekday";

/** Slate groupings by CT kickoff hour (docs/SPEC.md §7). */
export function kickoffWindow(iso: string): KickoffWindow {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CREW_TZ,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 12);

  if (weekday !== "Sat") return "Weekday";
  if (hour < 14) return "Noon";
  if (hour < 17) return "Afternoon";
  if (hour < 21) return "Primetime";
  return "Late Night";
}

export const WINDOW_ORDER: KickoffWindow[] = [
  "Noon",
  "Afternoon",
  "Primetime",
  "Late Night",
  "Weekday",
];

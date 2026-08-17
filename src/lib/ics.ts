/**
 * iCalendar (RFC 5545) builder for the subscribe-once feeds (R2-A3).
 *
 * Pure string assembly so vitest owns the RFC quirks: TEXT escaping
 * (backslash, semicolon, comma, newline), 75-octet line folding, UTC
 * timestamps, stable UIDs. The route handler supplies events; this file never
 * touches the database.
 */

export interface IcsEvent {
  /** Stable across refreshes — calendar clients key updates on it. */
  uid: string;
  /** ISO timestamp. */
  start: string;
  /** ISO timestamp; defaults to start + 3.5h (a football game). */
  end?: string;
  summary: string;
  description?: string;
}

const GAME_LENGTH_MS = 3.5 * 3600 * 1000;

/** RFC 5545 §3.3.11 TEXT escaping. Order matters: backslash first. */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** UTC timestamp in the compact form the spec wants: 20260905T233000Z. */
export function icsUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`ics: unparseable timestamp ${iso}`);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Fold a content line at 75 octets (§3.1), continuation lines led by one
 * space. Folding counts bytes, not code points — a summary full of ’ and –
 * must not produce a 76-octet line because we counted characters.
 */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cursor = 0;
  let first = true;
  while (cursor < bytes.length) {
    const budget = first ? 75 : 74; // continuation lines spend one octet on the lead space
    // Never split inside a UTF-8 sequence: back off while the next byte is a
    // continuation byte (0b10xxxxxx).
    let take = Math.min(budget, bytes.length - cursor);
    while (take > 1 && cursor + take < bytes.length && (bytes[cursor + take]! & 0xc0) === 0x80)
      take--;
    const chunk = new TextDecoder().decode(bytes.slice(cursor, cursor + take));
    out.push(first ? chunk : ` ${chunk}`);
    cursor += take;
    first = false;
  }
  return out.join("\r\n");
}

/**
 * One VCALENDAR. `generatedAt` is injected rather than read from the clock so
 * tests are byte-stable.
 */
export function buildCalendar(name: string, events: IcsEvent[], generatedAt: string): string {
  const stamp = icsUtc(generatedAt);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Slate//Feeds//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const e of events) {
    const end = e.end ?? new Date(new Date(e.start).getTime() + GAME_LENGTH_MS).toISOString();
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsUtc(e.start)}`,
      `DTEND:${icsUtc(end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

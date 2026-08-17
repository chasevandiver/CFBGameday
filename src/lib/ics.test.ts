import { describe, expect, it } from "vitest";
import { buildCalendar, escapeText, foldLine, icsUtc } from "./ics";

describe("escapeText", () => {
  it("escapes the four RFC 5545 TEXT specials, backslash first", () => {
    expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });
  it("handles CRLF as one newline", () => {
    expect(escapeText("a\r\nb")).toBe("a\\nb");
  });
});

describe("icsUtc", () => {
  it("renders compact UTC", () => {
    expect(icsUtc("2026-09-05T23:30:00.000Z")).toBe("20260905T233000Z");
  });
  it("normalizes an offset timestamp to Z", () => {
    expect(icsUtc("2026-09-05T18:30:00-05:00")).toBe("20260905T233000Z");
  });
  it("throws on garbage rather than emitting Invalid Date", () => {
    expect(() => icsUtc("not a date")).toThrow();
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });
  it("folds at 75 octets with a leading space on continuations", () => {
    const line = "SUMMARY:" + "x".repeat(100);
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]!.length).toBe(75);
    for (const p of parts.slice(1)) expect(p.startsWith(" ")).toBe(true);
    const unfolded = parts[0]! + parts.slice(1).map((p) => p.slice(1)).join("");
    expect(unfolded).toBe(line);
  });
  it("counts octets, not characters — multibyte text never yields a 76-octet line", () => {
    const line = "SUMMARY:" + "é".repeat(60);
    for (const part of foldLine(line).split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
  });
  it("never splits inside a UTF-8 sequence", () => {
    const line = "SUMMARY:" + "é".repeat(60);
    const unfolded = foldLine(line).split("\r\n").map((p, i) => (i === 0 ? p : p.slice(1))).join("");
    expect(unfolded).toBe(line);
  });
});

describe("buildCalendar", () => {
  const at = "2026-08-17T12:00:00.000Z";
  it("wraps events in a VCALENDAR with stable DTSTAMP", () => {
    const cal = buildCalendar(
      "The Slate",
      [{ uid: "slate-game-1", start: "2026-09-05T23:30:00Z", summary: "AUB @ UGA (CBS)" }],
      at,
    );
    expect(cal).toContain("BEGIN:VCALENDAR");
    expect(cal).toContain("X-WR-CALNAME:The Slate");
    expect(cal).toContain("UID:slate-game-1");
    expect(cal).toContain("DTSTAMP:20260817T120000Z");
    expect(cal).toContain("DTSTART:20260905T233000Z");
    // default game length: 3.5h
    expect(cal).toContain("DTEND:20260906T030000Z");
    expect(cal.endsWith("\r\n")).toBe(true);
  });
  it("is byte-stable for the same inputs", () => {
    const ev = [{ uid: "u", start: "2026-09-05T23:30:00Z", summary: "s" }];
    expect(buildCalendar("c", ev, at)).toBe(buildCalendar("c", ev, at));
  });
});

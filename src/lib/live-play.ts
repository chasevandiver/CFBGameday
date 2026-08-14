/**
 * Is this "last play" actually a play?
 *
 * ESPN's `situation.lastPlay` is whatever happened most recently, and a good
 * deal of that is not football: `"Official Timeout at 11:36."`,
 * `"Timeout #2 by DET at 01:21."`, the two-minute warning, the end of a
 * quarter. Those overwrite the real play in the stored row, and because a TV
 * timeout follows almost every score, the plays most likely to be replaced by
 * one are exactly the plays worth reading — the field goal, the extra point,
 * the touchdown (owner report 2026-08-14: "any tv timeout it says Official
 * Timeout… also I don't think made Field Goals or extra points are working").
 *
 * So the writer keeps what it already has when the incoming play is one of
 * these. It cannot be done in the UI: by the time the card renders, the real
 * play is gone from the database.
 *
 * Two signals, in order of trust:
 *
 * 1. **ESPN's `lastPlay.type.text`**, which is a small controlled vocabulary
 *    ("Rush", "Pass Reception", "Official Timeout", "End Period"). When it is
 *    present it decides, and the list below is deliberately short — anything
 *    unrecognised is treated as a play, so a new play type shows up rather
 *    than disappearing.
 * 2. **The text**, for CFBD, which supplies no type at all. Anchored at the
 *    start of the string so a play that merely mentions a timeout
 *    ("…for 6 yards. Timeout #1 by SF.") still counts as a play.
 *
 * Penalties are plays. They explain a flag on the field, which is exactly the
 * thing someone glancing at the card wants explained.
 */

/** ESPN `lastPlay.type.text` values that are not football. Lowercased. */
const NON_PLAY_TYPES = new Set([
  "official timeout",
  "timeout",
  "two-minute warning",
  "two minute warning",
  "end period",
  "end of period",
  "end of half",
  "end of game",
  "end of regulation",
  "coin toss",
]);

/** The same idea against raw text, for feeds that carry no type (CFBD). */
const NON_PLAY_TEXT =
  /^\s*(official\s+timeout|timeout\s*#?\d*(\s+by\b)?|two[-\s]minute\s+warning|end\s+(of\s+)?(the\s+)?(\d+(st|nd|rd|th)\s+)?(quarter|period|half|game|regulation)|coin\s+toss)\b/i;

/**
 * True when `text` describes something that happened on the field.
 *
 * `type` is ESPN's `lastPlay.type.text` when the feed supplies one. A null or
 * empty `text` is not a play — there is nothing to keep.
 */
export function isRealPlay(text: string | null | undefined, type?: string | null): boolean {
  if (!text || !text.trim()) return false;
  if (type && type.trim()) return !NON_PLAY_TYPES.has(type.trim().toLowerCase());
  return !NON_PLAY_TEXT.test(text);
}

/**
 * The `last_play` to store: the incoming one when it is a play, otherwise
 * whatever is already on the row.
 *
 * Returns `stored` unchanged during a timeout, so the diff sees no change and
 * no realtime message goes out for a play that did not happen.
 */
export function keepLastPlay(
  incoming: string | null | undefined,
  stored: string | null | undefined,
  type?: string | null,
): string | null {
  if (isRealPlay(incoming, type)) return incoming ?? null;
  return stored ?? null;
}

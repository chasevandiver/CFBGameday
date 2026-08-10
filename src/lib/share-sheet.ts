"use client";

/**
 * Handing plain text to the OS share sheet, with the clipboard as the fallback.
 *
 * `navigator.share` needs a user gesture and a secure context, and it does not
 * exist on desktop Safari or older browsers — so every share point on the site
 * needs the same two-step dance. It lived inside ShareButton, which meant a
 * second share point (the bet slip) could only exist by copying it. One
 * implementation, so "Share" behaves identically wherever it is offered.
 *
 * Only `text` is passed: adding `url` makes iOS append a link that pushes the
 * picks off the message preview.
 */
export type ShareOutcome = "shared" | "copied" | "dismissed" | "failed";

export async function shareOrCopy(text: string): Promise<ShareOutcome> {
  try {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      await navigator.share({ text });
      return "shared";
    }
  } catch (err) {
    // A dismissed share sheet rejects with AbortError. That is the user saying
    // no, not a failure to fall back from.
    if (err instanceof Error && err.name === "AbortError") return "dismissed";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

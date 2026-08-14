"use client";

/**
 * Handing a rendered card to the OS share sheet, with a download as the
 * fallback. Sibling to `share-sheet.ts`, which does the same for plain text.
 *
 * Two things are deliberately the same as the text path and one is different.
 * Same: a dismissed sheet rejects with AbortError and that is the user saying
 * no, not a failure to fall back from. Same: only one field is passed —
 * `share-sheet.ts` passes only `text` because adding `url` makes iOS append a
 * link that pushes the picks off the message preview, and the identical trap
 * applies here, so only `files` goes in. Adding a caption alongside the image
 * turns a full-bleed picture into a link preview with a thumbnail.
 *
 * Different: there is no clipboard fallback. Writing an image to the clipboard
 * is patchily supported and, where it works, produces something the user then
 * has to find somewhere to paste. A download is the honest second choice.
 */

export type ImageShareOutcome = "shared" | "downloaded" | "dismissed" | "failed";

export async function shareImage(payload: unknown, filename: string): Promise<ImageShareOutcome> {
  let blob: Blob;
  try {
    const res = await fetch("/api/share-card", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return "failed";
    blob = await res.blob();
    if (blob.size === 0) return "failed";
  } catch {
    return "failed";
  }

  const file = new File([blob], filename, { type: "image/png" });
  try {
    // canShare({files}) is the feature test that matters: Web Share exists on
    // plenty of browsers that refuse files, and share() would reject there
    // with a TypeError that is not a user cancellation.
    if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return "shared";
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return "dismissed";
    // Anything else falls through to the download rather than being reported
    // as a failure — the image exists, it just needs another way out.
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately races the download on some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return "downloaded";
  } catch {
    return "failed";
  }
}

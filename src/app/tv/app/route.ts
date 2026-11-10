import { NextResponse } from "next/server";

/**
 * Short address for installing the overlay app with Downloader on a Fire TV:
 * typing a GitHub release URL with a remote is miserable. The release is
 * rebuilt by .github/workflows/tv-overlay.yml on every change to tv-overlay/.
 */
const APK =
  "https://github.com/chasevandiver/CFBGameday/releases/download/tv-overlay/tv-overlay.apk";

export function GET() {
  return NextResponse.redirect(APK, 302);
}

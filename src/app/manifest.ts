import type { MetadataRoute } from "next";
import { BRAND } from "../lib/brand";

/** PWA manifest — home-screen install is a spec §8 requirement (mobile-first). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The CFB Slate",
    short_name: "CFB Slate",
    description:
      "College football ratings, edges, pick'em, and the crew ledger — what matters right now, every Saturday.",
    // The hub, not the slate: an installed app opens on what you have going
    // on, with the slate one tap away from it.
    start_url: "/",
    display: "standalone",
    // Near-black, matching the icon's ground. Android paints this before first
    // paint; anything lighter shows as a white flash between tap and app.
    background_color: BRAND.nearBlack,
    theme_color: BRAND.nearBlack,
    icons: [
      // `any` icons keep their full-bleed square — the launcher applies its own
      // corner treatment. `maskable` are the same artwork with the S pulled
      // inside the 80% safe circle, so a round launcher never clips the letter.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-1024.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

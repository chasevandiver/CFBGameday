import type { MetadataRoute } from "next";
import { BRAND } from "../lib/brand";

/** PWA manifest — home-screen install is a spec §8 requirement (mobile-first). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Slate",
    short_name: "The Slate",
    description:
      "College football and NFL ratings, edges, pick'em, and the crew ledger — what matters right now, every game day.",
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
      // corner treatment. The maskable entries are the *same* artwork, not a
      // second composition: the S already sits at 0.37 of the canvas from
      // centre, inside the 0.40 safe radius, so a round crop never clips it.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // The supplied artwork itself, at its native size — re-encoding it at
      // 1024 would add a megabyte of near-identical pixels to the repo.
      {
        src: "/brand/slate-icon-source.png",
        sizes: "1254x1254",
        type: "image/png",
        purpose: "any",
      },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

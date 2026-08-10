import type { MetadataRoute } from "next";

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
    background_color: "#12100D",
    theme_color: "#12100D",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}

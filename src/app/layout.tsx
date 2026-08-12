import type { Metadata, Viewport } from "next";
import { Archivo, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import { APPLE_STARTUP_IMAGES } from "../lib/apple-startup-images";
import { BRAND } from "../lib/brand";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-body",
  subsets: ["latin"],
});

const barlow = Barlow_Condensed({
  variable: "--font-display",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-numeric",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://cfb-gameday.vercel.app"),
  title: {
    default: "The CFB Slate",
    template: "%s · The CFB Slate",
  },
  description:
    "College football ratings, edges, pick'em, and the crew ledger — what matters right now, every Saturday.",
  applicationName: "The CFB Slate",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // What sits under the icon on the home screen. "The CFB Slate" truncates
    // to an ellipsis there; the icon already says which app this is.
    title: "CFB Slate",
    // Not black-translucent: the app does not pad for the top inset, and a
    // translucent bar would drop the status text on top of the header.
    statusBarStyle: "black",
  },
  openGraph: {
    siteName: "The CFB Slate",
    type: "website",
  },
};

export const viewport: Viewport = {
  /* Required for env(safe-area-inset-*) to report anything but 0 — the bottom
     nav and the bet slip both sit in the home-indicator zone. */
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: BRAND.nearBlack },
    { media: "(prefers-color-scheme: light)", color: "#F2F3F6" },
  ],
};

/* Runs before paint so a saved light-mode choice never flashes dark. */
const themeInit = `(function(){try{if(localStorage.getItem("slate-theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${barlow.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        {/* Next emits the standardised `mobile-web-app-capable`; iOS before
            16.4 only reads the apple-prefixed one, and that is exactly the
            population that would otherwise get a Safari chrome bar. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* Written by hand, not by the metadata API: Next has no
            apple-touch-startup-image field, and iOS needs one exact
            device-media match or it shows a blank frame on launch. */}
        {APPLE_STARTUP_IMAGES.map(({ href, media }) => (
          <link key={href} rel="apple-touch-startup-image" href={href} media={media} />
        ))}
      </head>
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
        {/* pb clears the fixed bottom nav on mobile */}
        <footer className="mx-auto w-full max-w-7xl px-4 pb-20 pt-6 text-center text-[11px] leading-relaxed text-chalk/40 sm:pb-6">
          No money moves through this site — it&rsquo;s a scorekeeping ledger for a private group.
          If gambling stops being fun, call 1-800-GAMBLER.
        </footer>
      </body>
    </html>
  );
}

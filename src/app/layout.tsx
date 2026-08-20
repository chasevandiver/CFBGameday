import type { Metadata, Viewport } from "next";
import { Archivo, Barlow_Condensed, Graduate, IBM_Plex_Mono, Permanent_Marker } from "next/font/google";
import { APPLE_STARTUP_IMAGES } from "../lib/apple-startup-images";
import { FunAtmosphere } from "../components/FunAtmosphere";
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

/* The brand's display face (docs/BRAND.md §12). Loaded always, applied only by
   the Field theme — the default themes keep the condensed face the product was
   designed around. One weight is all Graduate has, and all it needs. */
const graduate = Graduate({
  variable: "--font-display-brand",
  weight: "400",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-numeric",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

/* Fun Mode's one font exemption (FUN-10, owner-approved 2026-08-20): crowd
   signs are handwriting on posterboard, and none of the four product faces
   can fake a hand. Used by `.fun-sign-body` and nothing else; the file only
   downloads on pages that render a sign. */
const marker = Permanent_Marker({
  variable: "--font-marker",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://cfb-gameday.vercel.app"),
  title: {
    default: "The Slate",
    template: "%s · The Slate",
  },
  description:
    "College football and NFL ratings, edges, pick'em, and the crew ledger — what matters right now, every game day.",
  applicationName: "The Slate",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // What sits under the icon on the home screen. It has room for about a
    // dozen characters before the ellipsis, which "The Slate" now fits — the
    // old "CFB Slate" was a truncation workaround for a longer name.
    title: "The Slate",
    // Not black-translucent: the app does not pad for the top inset, and a
    // translucent bar would drop the status text on top of the header.
    statusBarStyle: "black",
  },
  openGraph: {
    siteName: "The Slate",
    type: "website",
  },
};

export const viewport: Viewport = {
  /* Required for env(safe-area-inset-*) to report anything but 0 — the bottom
     nav and the bet slip both sit in the home-indicator zone. */
  viewportFit: "cover",
  /* UX-35 — zoom off, owner request 2026-08-14 ("Pinch to zoom makes the site
     look weird on the web app. Let's take out zooming entirely.").

     ## This fails WCAG 2.1 SC 1.4.4, knowingly

     It is recorded as a residual in docs/STATUS.md §6 rather than left for
     someone to rediscover as a bug and "fix" back. The mitigation that makes it
     defensible is that the layout is already fluid and reflows to the OS text
     size — nothing here is a fixed-width image of text — so a reader who needs
     larger type gets it from Settings rather than from pinching. If that ever
     stops being true, this comes out.

     ## Why three changes and not one

     None of these covers every surface on its own:
       - `userScalable` / `maximumScale` are honoured by the INSTALLED PWA,
         which is where the problem was reported, and by Android Chrome.
       - Safari in a browser tab has ignored `user-scalable=no` since iOS 10;
         `touch-action` in globals.css and the gesture handler below are what
         reach it.
     `width` and `initialScale` are stated explicitly rather than left to
     Next's defaults: they are the values the scale limits are relative to, and
     leaving them implicit here would make this block read as if it only half
     applied. */
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    // The app's own dark ground, not the icon's: a media query cannot know
    // whether the reader has picked the Field theme, so this tracks the
    // default the OS will ask for. The launch chrome in manifest.ts stays on
    // the brand near-black, which is what the icon sits on.
    { media: "(prefers-color-scheme: dark)", color: "#100e0b" },
    { media: "(prefers-color-scheme: light)", color: "#F2F3F6" },
  ],
};

/* Runs before paint so a saved theme never flashes the default one first. */
const themeInit = `(function(){try{var t=localStorage.getItem("slate-theme");if(t==="light"||t==="field")document.documentElement.dataset.theme=t}catch(e){}})()`;

/* Fun Mode's CSS-gated pieces (FUN-1), same pre-paint reasoning as the theme:
   the fall light and the broadcast/rivalry treatments are stylesheet rules
   keyed on html[data-fun-*], and settling them after hydration would flash the
   plain app first. Mirrors syncAttributes() in src/lib/fun-mode.ts — change
   one, change both. The daypart set here is the no-override reading; the
   FunAtmosphere component takes ownership (and the ?daypart=/?funday=
   previews) from hydration on. */
const funInit = `(function(){try{var p=JSON.parse(localStorage.getItem("slate-fun")||"null");if(!p||!p.master)return;var d=document.documentElement.dataset;if(p.fallLight!==false){d.funLight="";var n=new Date(),w=n.getDay();if(w===0||w===6){var h=n.getHours();d.daypart=h<11?"dawn":h<15?"noon":h<18?"golden":"lights"}}if(p.broadcast!==false)d.funBroadcast="";if(p.rivalry!==false)d.funRivalry="";if(p.pulse!==false)d.funPulse="";if(p.ripples!==false)d.funRipples="";if(p.transitions!==false)d.funVt=""}catch(e){}})()`;

/* UX-35's Safari half. `user-scalable=no` in the viewport meta is honoured by
   the installed PWA but ignored by Safari in a browser tab, where pinch is
   delivered as the non-standard `gesture*` events — so refusing those is the
   only way to reach it. `passive: false` is required or preventDefault is
   dropped on the floor.

   Deliberately narrow: it cancels the pinch gesture and nothing else. Scroll,
   tap and swipe never produce a `gesturestart`, so none of them are touched.
   Guarded on the event existing at all, so it is inert on every browser that
   is not WebKit rather than throwing there. */
const zoomOff = `(function(){if(!("ongesturestart" in window))return;var s=function(e){e.preventDefault()};["gesturestart","gesturechange","gestureend"].forEach(function(n){document.addEventListener(n,s,{passive:false})})})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${barlow.variable} ${graduate.variable} ${plexMono.variable} ${marker.variable} h-full antialiased`}
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
        <script dangerouslySetInnerHTML={{ __html: funInit }} />
        <script dangerouslySetInnerHTML={{ __html: zoomOff }} />
        <FunAtmosphere />
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

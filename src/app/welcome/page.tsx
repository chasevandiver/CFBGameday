import { WelcomeContent } from "../../components/welcome/WelcomeContent";

/**
 * The marketing page — the link you send someone who has never seen the site.
 *
 * ## Why it is a page and not the front door
 *
 * `/` stays what it was: a signed-out visitor gets the week and a way in, not a
 * pitch (see the docblock on `app/page.tsx`, and `lib/supabase/middleware.ts`
 * for why the whole site is readable signed out). Owner decision, 2026-08-15 —
 * this is a thing to *send*, and the people who already have the URL in their
 * home screen should not have to walk past an advertisement to reach Saturday.
 * The signed-out hub links here instead, as does the login screen.
 *
 * ## Why it is coloured differently from the app
 *
 * The app runs on the charcoal tokens; this runs on the brand palette
 * (BRAND.md §5) via `.brand-surface`, which is the same call already made for
 * the share card — a launch surface colours from the identity. The palette is
 * pinned rather than themed, so the page looks the same in a screenshot no
 * matter which theme the person sending it happens to use.
 *
 * Static: no session, no Supabase call, nothing to look up. It renders at build
 * time and is the cheapest page on the site, which is the right property for
 * the one that strangers open.
 */

/**
 * The page is near-black in every theme, so the browser chrome has to be too —
 * the root layout tracks the OS preference and would hand a light-mode visitor
 * a #F2F3F6 status bar above a dark page. Only `themeColor` is set here; the
 * rest of the root viewport (viewport-fit, the UX-35 zoom decision) is
 * inherited.
 */
export const viewport = { themeColor: "#020A08" };

export const metadata = {
  title: { absolute: "The Slate — ratings, edges, pick'em and the crew ledger" },
  description:
    "A private football command center for a group that watches all of it and bets some of it: model ratings against the market, pick'em that locks the line when you take it, and a shared ledger graded on closing-line value. College football and the NFL.",
  openGraph: {
    title: "The Slate",
    description:
      "Ratings, edges, pick'em and the crew ledger — every game and every dollar riding on it, on one screen.",
  },
};

export default function WelcomePage() {
  return <WelcomeContent />;
}

# Design rules

Project-specific design context. General design principles are handled by the installed skills, not here.

**Division of labor.** `frontend-design` owns aesthetic direction: palette, typography, restraint, avoiding templated defaults. `web-design-guidelines` owns the review pass: accessibility, UX standards, interface quality. `vercel-react-best-practices` owns performance. This file only covers what those skills cannot know about this product. Do not duplicate them here, and if this file contradicts one of them, say so instead of picking silently.

---

## The product

Mobile-only companion for college football Saturdays. Live scores, spreads, group pick'em, running ledger. People keep it open for hours next to a TV.

Constraints that follow from that, and that override generic guidance:

- **Glanceable, not browsable.** Someone picks up the phone, gets an answer in under two seconds, puts it down. The most important number on a screen is the largest thing on it.
- **No layout shift on updates.** Tabular figures everywhere. A score going 9 to 10 shifts nothing.
- **Never steal scroll position.** Data updates in place. No re-mounting lists, no scroll-to-top on refresh.
- **Thumb zone.** Primary actions in the bottom third. Assume one hand.
- **44px minimum tap targets**, including inside dense rows.
- **Respect safe-area insets.**
- **Design for a dim room.** This gets used at night with a TV on.

---

## Two modes

Ask which mode applies if it isn't obvious.

### Exploration mode

For generating design directions to look at. The token constraints below do not apply. The point is to see something different.

Output standalone HTML to `public/design/`, one file per direction, named `direction-a.html`, `direction-b.html`, and so on. Self-contained: inline CSS, no build step, no imports from the app. Vercel serves the folder directly so they open on a phone.

- **Use real content.** Actual team names, real spreads, plausible scores, the real pick'em and ledger structure. Placeholder text hides the layout breaks that only appear with real string lengths. "Miami (OH) at Western Michigan" is the test case, not "Team A at Team B."
- **One screen, done fully.** Live scores unless told otherwise.
- **Make the directions genuinely different.** They should differ in information density, what the hierarchy leads with, how live state is expressed, and how the primary action is reached. If two could be described with the same sentence, redo one.
- **Show the plan before writing code.** Per direction: palette as 4 to 6 named hex values, typefaces with their roles, layout concept in one sentence, and the single element it's remembered by. Wait for a decision before building.
- **Report back** with what each direction trades off, plus the URLs.

Draw from the subject's own world for ideas: broadcast graphics, stadium signage, betting sheets, box scores.

### Implementation mode

Everything else. The existing design is the source of truth.

Once a direction is chosen, extract its tokens into the real stylesheet as named values first. Then build from those tokens. Never hardcode a color or size inside a component.

From that point these are hard:

- **No new colors.** Use defined values. If a state has no color, ask.
- **No new fonts or weights.**
- **No new spacing values.** Snap to the existing scale.
- **No new radius values.** Match the neighbors.
- **No new dependencies for visual work.**

Where a mockup and the codebase conflict, flag it and ask. Do not guess.

Build one screen completely, get it approved, then propagate its patterns. Do not redesign everything at once.

---

## Before saying it's done

Run the `web-design-guidelines` review on your own work, unprompted. Then add the three checks that skill can't make:

- Does live data update without shifting layout or losing scroll position?
- Is the primary action reachable one-handed?
- Would someone scrolling from an existing screen to this one notice a seam?

Report findings as a short list: what's wrong, where, the specific fix. Separate what you already fixed from what needs a decision. Don't pad it, and don't soften a real problem into a suggestion.

If you have not seen the page rendered, say so rather than claiming it looks right.

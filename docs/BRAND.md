# The CFB Slate — Brand System & Visual Identity

**Version 1.0 — August 2026.** Supplied by the owner. This is the identity
spec: what the mark is, what the palette is, and what the launch surfaces have
to look like. Section numbers here are the `§` references in
`scripts/lib/brand-mark.ts`, `src/lib/brand.ts` and `src/app/manifest.ts`.

`docs/DESIGN.md` still owns *how the product is built* — glanceable, no layout
shift, thumb zone, and the two modes. Where the two touch, DESIGN.md governs
behaviour and this file governs identity. **What has actually shipped from this
spec, and what has not, is in `docs/STATUS.md` (BRAND-1…BRAND-5), not here.**

---

## 1. Brand definition

The CFB Slate is a private, serious sports intelligence and betting/pick'em
command center: college football, NFL, betting edges, predictions, pick'em,
power ratings, game tracking, live scores, post-game results, bet tracking,
team intelligence. Built for a small group of serious users, not casual sports
browsing.

Old-school gameday program × betting ledger × modern sports intelligence
terminal. Credible enough that a user trusts the numbers before they read them.

Confident, never loud. Analytical, never sterile. Athletic, never cartoonish.
Premium, never luxury-fashion. Nostalgic, but clearly modern. Betting-aware,
without looking like a sportsbook advertisement.

## 2. The core idea — THE SLATE

The slate of games. Every Saturday the user opens The CFB Slate and sees the
day's board: games, lines, edges, picks, ratings, results, live movement.

The name is broader than college football. The identity must comfortably carry
CFB + NFL + betting + pick'em + intelligence. **Do not visually lock the
identity to college football alone.** The icon communicates *football +
intelligence + picks + the slate*, not *college football only*.

## 3. Primary icon direction — the Slate S

A large varsity S integrated with football geometry:

1. A large cream/chalk varsity S
2. Gold dimensional edging
3. A stylized gold football seam/lace element through the centre
4. Subtle football-field markings
5. Deep green/near-black background
6. Green-to-gold dimensional rim lighting
7. Extremely restrained texture
8. No additional text

The S is the hero. The football element is secondary. The field markings are
tertiary. At a glance: **S.** Closer: **football + slate + picks.** That
hierarchy is critical.

## 4. Icon philosophy

Must work at ~60×60pt on an iPhone home screen. At that size the user should
perceive: cream S, gold football seam, dark green field. Everything else
disappears into the texture.

Do not add: "CFB", "NFL", "The CFB Slate", "Bet", "$", odds, team logos, helmet
imagery, multiple footballs, excessive field graphics, tiny text. The
home-screen label already carries the name.

## 5. Colour system

| Token | Hex | Use |
|---|---|---|
| Field Green | `#08251C` | App background, icon background, headers, navigation, large surfaces |
| Raised Field Green | `#0E3B2C` | Elevated surfaces, cards, secondary icon depth, interactive surfaces |
| Near Black | `#020A08` | Primary background, deep shadows, icon negative space, high-contrast surfaces |
| Chalk White | `#F4EFE2` | Primary text and the icon S. Chalk, printed programs, old scoreboard paint — **not** pure digital white |
| Goalpost Gold | `#E8B93D` | Football seams, important metrics, positive edges, selected states, key CTAs, icon detailing, borders. Controlled, not sprayed |
| Penalty Orange | `#E4572E` | Extremely sparingly: negative betting indicators, warnings, bad lines, losses, penalties. Never a primary brand colour |

## 6. Colour ratio

60% near black / deep green · 25% raised green surfaces · 10% chalk · 5% gold.
Orange under 1–2%. The product feels green and dark first; gold is an accent
discovered inside the interface.

## 7. Icon construction

**Background.** Full-bleed square, `#020A08` transitioning toward `#08251C`.
Extremely subtle field texture allowed. No photograph, no literal grass, no
neon.

**Field markings.** Extremely subtle green lines: yard lines, hash marks, yard
numbers, centre line, small directional markers. Low enough opacity that they
disappear at small sizes. The field is a texture, not the subject. Markings
must work for **both NCAA and NFL** — nothing that identifies one league.

## 8. The S

Strong collegiate/varsity construction: heavy weight, angular corners, slightly
condensed, strong silhouette, minimal internal detail, cream/chalk fill, gold
dimensional edge. Must stay recognisable at ~40px.

Avoid thin serifs, modern geometric sans, script, ornate collegiate lettering,
3D chrome, excessive beveling. University athletic identity **without looking
like an existing university.**

## 9. Football element

The seam is the key secondary device. It intersects the S near its centre:
gold, thin, elegant, slightly curved, clearly football-inspired, integrated
into the letter rather than floating above it. Never overwhelms the S. At 60px
it reads as a gold curved interruption; at large sizes the lace detail appears.
Small: premium S icon. Large: football S icon.

## 10. Lighting

Controlled dimensional glow. Upper-left: subtle cool/green light. Lower-right:
subtle warm gold light. Green → Gold is the signature. A physical object lit in
a dark sports environment — not a crypto/Web3/neon gaming logo.

## 11. Material language

Subtle glass depth, controlled highlights, soft inner shadows, fine material
texture, slight metallic gold edge, subtle green aura. No frosted-glass blobs,
rainbow gradients, heavy bloom, lens flares, chrome, or excessive reflections.
The icon should look expensive because of restraint.

## 12. Typography

- **Display: Graduate.** Page titles, brand moments, large section labels,
  pick'em headings, feature callouts. Never body copy.
- **Body: Archivo.** Navigation, cards, descriptions, buttons, labels.
- **Numbers: IBM Plex Mono.** Lines, scores, percentages, ratings, model
  probabilities, edges, records, odds, clocks, stats. Numbers are a major part
  of the brand — betting ledger / scoreboard, not generic web typography.

## 13–15. UI, glass, aura

Primary surfaces dark green / near black. Cards translucent raised green.
Borders extremely subtle green/white opacity. Highlights gold. Positive edge
gold or restrained green. Negative edge penalty orange. Information chalk.

Glass restrained: low-opacity green surfaces, subtle backdrop blur, thin
borders, soft inner highlights, background aura — a dark sports broadcast
interface, not a futuristic crypto dashboard.

Subtle radial auras behind major surfaces: deep green primary, goalpost gold
secondary. Gold aura localized around strong edges, winning picks, featured
games, key actions, important metrics. Never fill the screen with gold.

## 16. Betting language

Preferred: edge, model, pick, projection, rating, line, spread, total,
probability, confidence, value, record, result. Avoid casino language: dollar
signs, slot-machine visuals, flashing green, "WIN BIG", "LOCK", "GUARANTEED",
"EASY MONEY". An intelligence tool, not a gambling advertisement.

## 17. NFL + CFB positioning

Both leagues equally. College football brings varsity typography, field
markings, gameday-program texture, traditional athletic vocabulary. NFL brings
scoreboard numerals, broadcast-inspired layouts, clean statistical
presentation, professional game-card treatment. **No separate NFL and CFB
logos** — the S + seam is the umbrella identity.

## 18. Icon variants

Primary iOS/PWA icon: 1024×1024 PNG, full bleed, no transparency, no
pre-rounded corners, no text. Secondary exports at 512, 192, 180, 32, all
derived from the master. **Do not independently redesign each size.**

## 19. Android maskable

512×512 and 192×192 maskable. All meaningful content inside the centre ~80%
safe area. The S must not approach the circular crop. Field markings may extend
beyond it because they are decorative; the S and seam may not.

## 20. Vector master

True vector master on a 1024×1024 grid:

```
CFB-Slate-Icon
├── Background        Near Black · Green Aura · Field Texture
├── Field Markings    Yard Lines · Hash Marks · Yard Numbers
├── S                 Chalk Fill · Gold Edge · Shadow
├── Football Seam     Gold Seam · Lace Detail · Shadow
└── Lighting          Green Highlight · Gold Highlight
```

All typography converted to outlines before final export. No font dependency in
the final vector asset.

## 21. Small-size testing — mandatory

Do not judge the icon at 1024px. Generate a contact sheet at 300 / 120 / 72 /
60 / 40 / 32px on near-black. At 60px ask: can I immediately identify the S;
does the seam survive; does it look like a real commercial app; does it look
different from a generic sports logo; does it still feel premium; is the gold
still controlled; does anything look like visual noise. **Any "no" means
simplify.**

## 22. Real-app row test

The icon beside DraftKings, ESPN and Action Network on a dark iPhone wallpaper.
It must not look homemade, like a favicon, like a school logo, like a fantasy
app, like a crypto app, like a casino, or like an AI-generated logo. It should
look like a serious sports product someone intentionally designed.

## 23–24. Splash

Extends the icon's world rather than enlarging the icon. `#020A08` with an
extremely subtle green aura, the S/football mark centred, `THE CFB SLATE` in
Graduate below, and a supporting line — e.g. `RATINGS · PREDICTIONS · PICKS ·
BET TRACKING` — in IBM Plex Mono or Archivo. Enormous negative space. No
casino-style loading animation. Opening a premium sports terminal before
Saturday begins.

## 25. PWA implementation

This is a PWA, not a native iOS app. iOS does not apply Liquid Glass to the
icon. The PNG must carry its own depth and lighting. No transparency, no
pre-rounding, no reliance on OS-generated effects — the artwork must look
correct by itself.

## 26. Manifest

Through `app/manifest.ts`: name `The CFB Slate`, short name `CFB Slate`,
description, start URL, `display: standalone`, `theme_color: #020A08`,
`background_color: #020A08`, standard icons, maskable icons. No white browser
chrome during launch.

## 27–29. Layout metadata, iOS splash, launch experience

`app/layout.tsx` carries manifest, Apple web-app capable, Apple web-app title,
Apple touch icon, theme colour, viewport behaviour and startup images.
**`apple-touch-startup-image` link tags must be written by hand — the Next
metadata API has no field for them.**

Portrait startup screens for iPhone 11 through the current Pro Max, iPad mini,
iPad Air, iPad Pro 11" and iPad Pro 12.9", via device-specific media queries.
Always near-black background, green aura, central S, gold seam, wordmark.
**Never a white splash.**

Desired experience: home screen → tap S → immediate dark-green branded splash →
application already feeling like a native sports product. No visual jump
between icon, splash and app shell — the same green + chalk + gold material
language in all three.

## 30. Favicon

The 32px icon is a simplified version of the same mark: keep the S, keep the
seam if legible, remove nonessential field numbers, remove unnecessary texture,
preserve contrast. Not a different mark.

## 31–35. Share cards, game cards, pick'em, edge, states

OG cards: dark green/black, large S mark, gold accent, matchup, line, model
edge, CFB Slate branding — the icon appearing as a small brand stamp.

Game cards descend from the icon: deep green cards, chalk team names, IBM Plex
Mono statistics, gold selected values, thin field-inspired dividers, subtle
green glow, minimal gold borders. Premium betting boards, not generic SaaS
cards.

Pick'em leans slightly more collegiate: Graduate headings, chalk, gold selected
picks, strong matchup typography, record counters in Plex Mono.

Gold is the visual language for **value** — it highlights the difference, not
every number. Positive: gold + green. Neutral: chalk + muted green. Negative:
penalty orange. Live: gold pulse or restrained green. Never huge neon "WIN"
treatments.

## 36–37. Logo usage

**Correct:** S mark alone · S + seam · S mark with wordmark · wordmark on dark
green · wordmark in chalk · gold accent.

**Incorrect:** stretching · rotating · shadows outside the system · random
gradients · team colours · placing on white unless explicitly required · dollar
signs · NFL/CFB labels on the icon · drop shadows that change the silhouette.

Wordmark: `THE CFB SLATE` in Graduate, stacked or single-line by context. The
wordmark must not compete with the icon — **the icon is the primary brand
asset.**

## 38. Voice

Good: `MODEL EDGE +3.4%` · `TEXAS —2.5` · `71% COVER PROBABILITY` ·
`SLATE RANK #4` · `12–7 SEASON RECORD`.

Avoid: 🔥 LOCK OF THE WEEK 🔥 · FREE MONEY · ABSOLUTE HAMMER · THIS ONE CAN'T
MISS · GUARANTEED WINNER. Sound like an analyst who has done the work.

## 39. North star

*Would this look at home on a Saturday morning with a gameday program, a
betting sheet, and ESPN on in the background?* If it looks like a casino, a
crypto platform, a fantasy app, a generic SaaS dashboard, a school athletic
department, or a children's sports app — reject it.

## 40. Final direction

THE SLATE S. A premium varsity S. A football seam. A dark field. Chalk. Gold.
Green. Numbers. Edges. Saturday.

Final hierarchy: **S → football → field → gold edge.** Everything else is
supporting material.

---

## 41. Implementation instructions

1. Inspect the existing design system before changing anything.
2. Preserve existing functionality.
3. Do not rebuild working pages unnecessarily.
4. Replace inconsistent colours with the approved token system.
5. Replace inconsistent typography with Graduate / Archivo / IBM Plex Mono.
6. Implement the S icon consistently across PWA, favicon, navigation, splash
   screens, OG/share cards, loading states.
7. Ensure NFL and CFB both feel native.
8. Remove visual elements that make the product look CFB-only.
9. Maintain dark-first presentation.
10. No neon sportsbook aesthetics.
11. No excessive glass.
12. No team-specific branding in the global identity.
13. Test every major component at mobile width.
14. Test the icon at 60px and below.
15. Verify the PWA install experience on iOS.
16. Verify Android maskable behaviour.
17. Verify there is no white launch/splash band.
18. Verify the icon has no transparent pixels.
19. Verify the icon has no baked-in rounded corners.
20. Final visual consistency audit across the application.

## 42. Definition of done

The new S/football icon is the primary identity · NFL and CFB both feel native
· the icon is recognisable at 60px, works at 40px and 32px · it passes the
real-app row test · no transparency · no baked-in rounded corners · Android
maskable respects the 80% safe area · iOS splash screens use the dark
background · no white status/launch band · `app/manifest.ts` implemented ·
`app/layout.tsx` includes the Apple startup-image tags · all required icon
exports exist · vector master exists with outlined typography · Graduate for
display · Archivo for UI/body · IBM Plex Mono for numbers · colour tokens match
the palette · gold is an accent, not dominant · orange reserved for
negative/warning · betting UI feels analytical, not casino · NFL + CFB feel
like one product · existing functionality intact · the whole product feels like
one designed system.

---

## Final statement

The CFB Slate is not a sportsbook. It is the serious user's football slate —
where the games, numbers, models, picks, edges and results come together. The
visual identity should make that obvious without ever having to say it.

Dark field. Chalk S. Gold seam. Numbers. Edge. That's The Slate.

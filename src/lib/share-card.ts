/**
 * The image share of a member's bets — everything about it that is a decision
 * rather than a pixel.
 *
 * Sibling to `share-text.ts`, and deliberately the same shape: pure, no React,
 * no I/O, so the ordering and the headings can be pinned by tests instead of
 * eyeballed in a share sheet. The route renders whatever this returns.
 *
 * The card exists to do the one thing the text share admits it cannot.
 * `share-text.ts` opens by conceding that iMessage's proportional font means
 * "no amount of padding will make columns line up" — so the units column here
 * is fixed-width and every stake is printed to one decimal, because a column
 * that actually aligns is the entire argument for shipping an image.
 *
 * Layout lives in `public/design/share-card-d.html`, which renders all four
 * hero states.
 */

import { CONFIDENCE_TIERS, type ConfidenceTier } from "./db-types";
import { DEFAULT_TZ, kickHeading, kickShort, kickSlot, nflKickSlot } from "./kick";

export interface ShareCardTeam {
  abbr: string;
  /** Absolute URL. Null falls back to the abbr monogram, as TeamMark does. */
  logo: string | null;
  color: string | null;
}

export interface ShareCardBet {
  /** `${gameId}:${betType}` for a game bet, or `future:${id}`. */
  key: string;
  tier: ConfidenceTier;
  /** The pick as the bettor took it: "Georgia −6.5", "Over 51.5". */
  pick: string;
  /** "Tennessee at Georgia", "Ole Miss / LSU", "Season futures". */
  matchup: string;
  /** Both null for a future, which has no game and therefore no logos. */
  away: ShareCardTeam | null;
  home: ShareCardTeam | null;
  units: number;
  /** American. */
  odds: number;
  /** ISO kickoff. Null for a future, or a game with no announced time. */
  kickTs: string | null;
  /** The NFL names its windows differently. Defaults to college. */
  league?: "cfb" | "nfl";
}

export interface ShareCardPayload {
  /** "<display_name> Bets" — the owner asked for exactly this. */
  title: string;
  /** "Week 3 · Sat Sep 12" */
  subtitle: string;
  bets: ShareCardBet[];
  /** Bets that did not fit, for the "+N more" line. */
  overflow: number;
}

/**
 * Twelve rows is where the layout stops being legible on a phone-sized
 * rendering of a 1350px card — measured in share-card-d.html, not guessed.
 */
export const MAX_CARD_BETS = 12;

/** Index into the ordered ladder. Higher is more conviction. */
export function tierRank(tier: ConfidenceTier): number {
  return CONFIDENCE_TIERS.indexOf(tier);
}

/**
 * Conviction first, then the clock — the sort the owner asked for.
 *
 * Unscheduled bets (futures, and games with no announced kickoff) sink to the
 * bottom of their own tier rather than sorting first off a null. Ties keep
 * input order, which is the order the bets were placed; `sort` has been
 * stable since ES2019 and `groupByKickoff` in share-text.ts already leans on
 * that, so this returns 0 rather than threading an index through.
 */
export function sortForCard(bets: ShareCardBet[]): ShareCardBet[] {
  return [...bets].sort((a, b) => {
    const byTier = tierRank(b.tier) - tierRank(a.tier);
    if (byTier !== 0) return byTier;
    const at = a.kickTs ?? null;
    const bt = b.kickTs ?? null;
    if (at === bt) return 0;
    if (at === null) return 1;
    if (bt === null) return -1;
    return at.localeCompare(bt);
  });
}

/**
 * The hero rule, and the whole rule: the top bet gets the panel **iff exactly
 * one bet sits alone at the highest tier present**.
 *
 * It lives here rather than as a check inside the JSX so it can be tested on
 * its own, because the failure it prevents is a quiet one. Direction C in the
 * first exploration round promoted its first row unconditionally, which on a
 * Saturday where every bet is the same tier means the card asserts that one of
 * them is special when nothing says so.
 *
 * A lone bet trivially satisfies this and gets the hero. That is not a special
 * case — it is the same sentence — and the card looks far better for it than a
 * single thin row on 1350px of empty field.
 */
export function heroBet(bets: ShareCardBet[]): ShareCardBet | null {
  if (bets.length === 0) return null;
  const top = Math.max(...bets.map((b) => tierRank(b.tier)));
  const atTop = bets.filter((b) => tierRank(b.tier) === top);
  return atTop.length === 1 ? atTop[0] : null;
}

/** The broadcast window a bet belongs to, in its own league's vocabulary. */
export function slotOf(bet: ShareCardBet): string | null {
  if (!bet.kickTs) return null;
  return bet.league === "nfl" ? nflKickSlot(bet.kickTs) : kickSlot(bet.kickTs);
}

/**
 * What a group of same-tier bets is called.
 *
 * The superlatives stay singular even over several rows — they are titles, not
 * categories, and "Bets of the Century" reads like a joke. The bottom two rungs
 * are categories and do pluralise.
 *
 * `slate` interpolates the broadcast window from the bet's own kickoff, so a
 * 2:30 CT bet heads a section called "Bet of the Afternoon Slate" with no
 * column anywhere storing "afternoon". Falls back to the bare "Bet of the
 * Slate" when there is no kickoff to read a window off.
 */
export function tierHeadline(bet: ShareCardBet, count: number): string {
  switch (bet.tier) {
    case "lean":
      return count === 1 ? "Lean" : "Leans";
    case "bet":
      return count === 1 ? "Bet" : "Bets";
    case "slate": {
      const slot = slotOf(bet);
      return slot ? `Bet of the ${slot} Slate` : "Bet of the Slate";
    }
    case "day":
      return "Bet of the Day";
    case "year":
      return "Bet of the Year";
    case "century":
      return "Bet of the Century";
  }
}

/**
 * Two `slate` bets in different windows are not the same section — one is the
 * bet of the afternoon and the other the bet of primetime — so the window is
 * part of the grouping key for that tier alone. Kickoff order already clusters
 * windows together, so this never fragments a run that should have been whole.
 */
function groupKeyOf(bet: ShareCardBet): string {
  return bet.tier === "slate" ? `slate:${slotOf(bet) ?? "tbd"}` : bet.tier;
}

export interface ShareCardGroup {
  tier: ConfidenceTier;
  heading: string;
  bets: ShareCardBet[];
}

/**
 * Consecutive same-tier runs, so a heading is printed on a tier *change*
 * rather than once per row. That is what buys back the vertical cost of
 * printing the tier in words at all — seven bets at one tier need one heading,
 * not seven. Same consecutive-run shape as `groupByKickoff`.
 *
 * Expects sorted input; call `sortForCard` first.
 */
export function groupByTier(bets: ShareCardBet[]): ShareCardGroup[] {
  const out: ShareCardGroup[] = [];
  let lastKey: string | null = null;
  for (const bet of bets) {
    const key = groupKeyOf(bet);
    if (lastKey === key && out.length > 0) {
      out[out.length - 1].bets.push(bet);
    } else {
      out.push({ tier: bet.tier, heading: "", bets: [bet] });
      lastKey = key;
    }
  }
  // The heading needs the group's size, so it is filled once the run is closed.
  for (const g of out) g.heading = tierHeadline(g.bets[0], g.bets.length);
  return out;
}

/**
 * Sort, then cut. The order matters: capping before sorting would drop bets by
 * the order they were placed and could throw away the Bet of the Year to keep
 * a lean.
 */
export function capForCard(bets: ShareCardBet[]): { bets: ShareCardBet[]; overflow: number } {
  const sorted = sortForCard(bets);
  return {
    bets: sorted.slice(0, MAX_CARD_BETS),
    overflow: Math.max(0, sorted.length - MAX_CARD_BETS),
  };
}

/**
 * Always one decimal, so the column aligns. `2u` above `1.5u` puts the decimal
 * points out of register and undoes the reason this is an image.
 */
export function formatUnits(units: number): string {
  return `${units.toFixed(1)}u`;
}

/**
 * A real minus sign (U+2212), not a hyphen: this is set in IBM Plex Mono at
 * display size on a card meant for a timeline, and a hyphen sits too high and
 * too short next to tabular figures.
 *
 * Plex Mono covers U+2212, but satori draws tofu rather than falling back when
 * a supplied font lacks a glyph — so whoever wires the fonts up in SHARE-5
 * must confirm coverage on the actual subset that ships, not on the family.
 */
export function formatOdds(odds: number): string {
  return odds < 0 ? `−${Math.abs(odds)}` : `+${odds}`;
}

/** Total staked, for the footer. */
export function totalUnits(bets: ShareCardBet[]): number {
  return bets.reduce((sum, b) => sum + b.units, 0);
}

/**
 * Swap characters the card's fonts do not carry for ones they do.
 *
 * satori draws a tofu box for a missing glyph rather than falling back to a
 * system face, so one uncovered codepoint in a school name is a visible defect
 * on a card meant for a timeline. Checked against the four TTFs in
 * `public/fonts/`: they cover U+2212, both curly quotes, the dashes, the middot
 * and Latin-1 accents — the single gap is the ʻokina, and Hawaiʻi is an FBS
 * school that appears in `0030_move_board_to_week_zero.sql`'s own comment.
 *
 * U+2019 is the closest covered shape and the substitution is invisible at
 * card sizes. Re-run the coverage check if the font set ever changes.
 */
const GLYPH_SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/ʻ/g, "’"], // ʻokina → right single quote
];

export function sanitizeForCard(text: string): string {
  return GLYPH_SUBSTITUTIONS.reduce((s, [from, to]) => s.replace(from, to), text);
}

/* ── how big everything is ────────────────────────────────────────────────── */

/** The fixed canvas, and the blocks whose height does not depend on the rows. */
export const CARD_H = 1350;
const HEAD_H = 145;
const FOOT_H = 97;
const HERO_H = 325;
const HEADING_H = 46;
const ROWS_MARGIN = 26;
const FILLER_PAD = 80;

/**
 * The shortest a row may be and still be read on a phone.
 *
 * Twelve bets was measured on a card with one heading and no hero. Add a hero
 * (325px, about five rows) and several tier headings and the same twelve no
 * longer fit — so something has to give, and it is the row *count*, not the row
 * height. Shrinking to fit produces a card nobody can read and does not admit
 * it; dropping the tail produces one that says "+3 more".
 */
const MIN_ROW_H = 72;

/** How many rows fit above the footer once the hero and headings are paid for. */
export function rowsThatFit(groupCount: number, hasHero: boolean): number {
  const chrome = HEAD_H + FOOT_H + (hasHero ? HERO_H : 0);
  const forRows = CARD_H - chrome - ROWS_MARGIN - groupCount * HEADING_H;
  return Math.max(1, Math.floor(forRows / MIN_ROW_H));
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * Title size, chosen so the name fits on one line.
 *
 * The header is not a fixed-height block, so a title that wraps pushes the meta
 * line down and makes `HEAD_H` a lie — and `HEAD_H` is what the row budget is
 * computed from, so a long name plus a full slip could push the footer off the
 * bottom. Display names are capped at 24 characters by `updateDisplayName`,
 * which with "’s Bets" is 31 uppercase characters, and 31 does not fit at 58.
 *
 * The width budget is not the full 968px content width: the S stamp sits at the
 * right of the header row and takes ~53px plus its gutter, and the title is a
 * `flex: 1` sibling, so a nowrap title that is too wide runs *under* the mark
 * rather than shrinking. 0.66em is Graduate's average uppercase advance,
 * measured off the rendered card — the first estimate of 0.62 was low and let a
 * long name reach the stamp.
 */
const TITLE_WIDTH = 860;
const TITLE_ADVANCE = 0.66;
const TITLE_MAX = 58;
const TITLE_MIN = 34;

export function titleFontSize(title: string, width = TITLE_WIDTH): number {
  if (title.length === 0) return TITLE_MAX;
  return clamp(width / (title.length * TITLE_ADVANCE), TITLE_MIN, TITLE_MAX);
}

export interface CardMetrics {
  rowH: number;
  crest: number;
  pick: number;
  matchup: number;
  units: number;
  sub: number;
  /** Width of the two-crest slot, so every pick starts at the same x. */
  crestSlot: number;
  /** Width of the right-hand number column, the one that has to register. */
  numsW: number;
  /** Height of the watermark that absorbs whatever is left. 0 = none. */
  markH: number;
  /**
   * Draw each row as a raised panel instead of a bare line.
   *
   * A one-to-three bet slip is the common case and the hardest to compose: at
   * row heights the seven-bet card was designed for, two bets are two thin
   * lines under 900px of nothing, which is what a real shared card looked
   * like. Giving those rows a surface is what fills the canvas — it is the
   * hero's own material language (§13–15) applied to a row, so nothing new is
   * invented, and it switches off the moment there is enough content to carry
   * the card on its own.
   */
  panel: boolean;
  /** Gap between panels; 0 when rows are bare lines. */
  panelGap: number;
}

/**
 * Row size as a function of how many rows there are.
 *
 * The first version of this card was sized for a seven-bet Saturday and used
 * those numbers no matter what, so a real two-bet slip came out as two small
 * rows above 900px of nothing. A share card is a fixed canvas holding a
 * variable-length list, and the list is usually *short* — so the type has to
 * grow into the space rather than the space being left over.
 *
 * Everything derives from `rowH`, and the ratios are set so that a *full*
 * twelve-row card reproduces the original numbers exactly — rowH 86 → crest 52,
 * pick 36, matchup 21, units 33, sub 20. That is deliberate and it is pinned by
 * a test: those sizes were designed against a rendered mockup of a full card,
 * and they should not drift because the sparse case got fixed. Every count
 * below twelve now scales up from there, which is the actual change.
 */
export function cardMetrics(rowCount: number, groupCount: number, hasHero: boolean): CardMetrics {
  const chrome = HEAD_H + FOOT_H + (hasHero ? HERO_H : 0);
  const forRows = CARD_H - chrome - (rowCount > 0 ? ROWS_MARGIN + groupCount * HEADING_H : 0);

  const panel = rowCount > 0 && rowCount <= 3 && !hasHero;
  const panelGap = panel ? 18 : 0;

  // The floor is legibility, and it is enforced rather than negotiated: when
  // the rows will not fit at MIN_ROW_H, `rowsThatFit` drops the extras into the
  // "+N more" line instead of shrinking everything until it technically fits.
  // The ceiling stops a short slip from stretching into bands of empty green;
  // panels get a taller one because a surface can carry height that a bare line
  // cannot.
  // Floor, not round. Rounding up is only half a pixel per row, but twelve rows
  // of it overran the canvas by 6px and pushed the footer off the bottom — the
  // overflow test below is what found it.
  const rowH =
    rowCount > 0
      ? clamp(Math.floor(forRows / rowCount) - panelGap, MIN_ROW_H, panel ? 300 : 152)
      : 0;

  const used =
    chrome +
    (rowCount > 0
      ? ROWS_MARGIN + groupCount * HEADING_H + rowCount * (rowH + panelGap)
      : 0);
  // The ceilings are geometry, not taste. A row is
  //   crestSlot + gutter + pick + numbers
  // across 968px, and the longest pick the product builds is 19 characters
  // ("OSU win total o10.5"). On a bare line that fits 19 characters of Archivo
  // bold at 48px and not at 52, and going past it makes long picks wrap, which
  // silently breaks the fixed row height.
  //
  // A panel lifts the ceiling because it removes the consequence: it is tall
  // enough for two lines, so a long pick wrapping inside one is fine. That is
  // what lets a two-bet card set its picks at 72px instead of 48 — the panel
  // has to be filled by its contents or it is just a bigger empty box.
  const crest = panel ? clamp(rowH * 0.5, 44, 130) : clamp(rowH * 0.6, 44, 96);
  const sub = clamp(rowH * 0.235, 18, panel ? 32 : 28);
  return {
    rowH,
    crest,
    pick: clamp(rowH * 0.42, 32, panel ? 72 : 48),
    matchup: clamp(rowH * 0.245, 19, panel ? 34 : 28),
    units: clamp(rowH * (panel ? 0.32 : 0.385), 30, panel ? 72 : 54),
    sub,
    // Side by side plus the gap in Crests, not the old overlap.
    crestSlot: Math.round(crest * 2.14),
    numsW: Math.round(sub * 8.2),
    // Below ~120px the mark is a sliver nobody reads as a mark, so it is
    // dropped rather than drawn two pixels tall.
    markH: CARD_H - used - FILLER_PAD < 120 ? 0 : clamp(Math.min(CARD_H - used - FILLER_PAD, 420), 0, 420),
    panel,
    panelGap,
  };
}

/* ── the render model ─────────────────────────────────────────────────────── */

/** A bet plus the strings the layout needs and the domain model does not store. */
export interface RenderBet extends ShareCardBet {
  /** "3:30p", or an em-dash pair when there is no kickoff. */
  kickShort: string;
  /** "SAT 3:30 PM CT" — the hero has room for the whole thing. */
  kickLong: string | null;
}

export interface CardGroup {
  heading: string;
  /** The bottom rung is set quieter; the layout should not re-derive that. */
  lean: boolean;
  bets: RenderBet[];
}

export interface CardModel {
  title: string;
  subtitle: string;
  /** Null when nothing stands alone at the top — see `heroBet`. */
  hero: (RenderBet & { heading: string }) | null;
  groups: CardGroup[];
  count: number;
  units: number;
  overflow: number;
}

/**
 * Everything the card renders, decided here rather than in JSX.
 *
 * Keeping this pure is what lets the four hero states be tested without
 * rendering a PNG — the layout ends up as a function of this object, so a
 * change to the promotion rule is a change to a value, not to a component.
 */
export function buildCardModel(payload: ShareCardPayload, tz: string = DEFAULT_TZ): CardModel {
  const render = (b: ShareCardBet): RenderBet => ({
    ...b,
    kickShort: b.kickTs ? kickShort(b.kickTs, tz) : "——",
    kickLong: b.kickTs ? kickHeading(b.kickTs, tz) : null,
  });

  const sorted = sortForCard(payload.bets);
  const hero = heroBet(sorted);
  const rest = hero ? sorted.filter((b) => b.key !== hero.key) : sorted;

  // Trim to what fits legibly. The group count feeds back into the budget, so
  // this is done against the grouping of the trimmed list, not the full one —
  // dropping rows can drop a heading with them and free up more space.
  let kept = rest;
  let groups = groupByTier(kept);
  for (let i = 0; i < 4; i++) {
    const fits = rowsThatFit(groups.length, !!hero);
    if (kept.length <= fits) break;
    kept = kept.slice(0, fits);
    groups = groupByTier(kept);
  }
  const dropped = rest.length - kept.length;

  return {
    title: payload.title,
    subtitle: payload.subtitle,
    hero: hero ? { ...render(hero), heading: tierHeadline(hero, 1) } : null,
    groups: groups.map((g) => ({
      heading: g.heading,
      lean: g.tier === "lean",
      bets: g.bets.map(render),
    })),
    // The footer still counts every bet that was handed in; `overflow` is what
    // the card admits it could not draw.
    count: payload.bets.length,
    units: totalUnits(payload.bets),
    overflow: payload.overflow + dropped,
  };
}

/**
 * Book names, canonicalised on write.
 *
 * `consensusFromSnapshots` takes the latest snapshot **per provider** and means
 * them, so a book stored under two spellings is averaged against itself and
 * gets double the weight of every other book. That is wrong in a way nobody
 * would notice by looking — the number still lands on a plausible half-point —
 * and CLV is graded against it.
 *
 * ## What was actually in the table (2026-08-19)
 *
 * DQ-14 recorded this as "one book under two names" on one game, and the fix it
 * prescribed was to normalise in the ESPN parser. Reading `line_snapshots`
 * instead of the one game corrected both halves:
 *
 * - It is **82 games**, not one.
 * - **Most of it is not ESPN.** `Draft Kings` splits 102 rows from
 *   `cfbd-backfill` against 33 from `espn`, so normalising the ESPN parser
 *   alone would have left three quarters of the defect in place and closed the
 *   row. CFBD emits both spellings too.
 *
 * Hence one normaliser, applied at every write path, rather than a fix at the
 * writer that happened to be looked at first.
 *
 * ## Why squash-and-look-up rather than a rename list
 *
 * Matching on the name with spacing, casing and punctuation removed means the
 * next spelling of a book already here ("DRAFTKINGS", "draft-kings") lands
 * without another edit. A rename list only catches the variants already seen,
 * which is how this defect survived two audits.
 *
 * Regional books are deliberately NOT merged. `Caesars`, `Caesars
 * (Pennsylvania)` and `Caesars Sportsbook (Colorado)` squash to three different
 * keys and stay three providers — they hang different numbers, and checked
 * against the table they never co-occur on a game (0 of 9,496), so merging them
 * would invent a double-count rather than remove one.
 */

/** Lowercase alphanumerics only: the identity a book keeps across spellings. */
function squash(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The canonical spelling of every provider observed in `line_snapshots`, which
 * makes this list a register of what the table actually holds as well as the
 * normalisation target. A name not in here passes through untouched — an
 * unknown book is stored as the feed spells it rather than guessed at.
 */
export const CANONICAL_PROVIDERS = [
  "DraftKings",
  "ESPN Bet",
  "Bovada",
  "Caesars",
  "Caesars (Pennsylvania)",
  "Caesars Sportsbook (Colorado)",
  "William Hill (New Jersey)",
  "SugarHouse",
  "teamrankings",
  "numberfire",
  "consensus",
] as const;

const BY_SQUASH = new Map(CANONICAL_PROVIDERS.map((name) => [squash(name), name as string]));

/**
 * The name a snapshot is stored under. Applied by every writer of
 * `line_snapshots` — `refresh-lines`, `nfl-refresh-lines`, `build-preseason`
 * and the archive backfill — so no one path can reintroduce a split.
 *
 * Whitespace is collapsed before lookup so an unknown book with a stray double
 * space does not become its own provider either.
 */
export function normalizeProvider(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return BY_SQUASH.get(squash(trimmed)) ?? trimmed;
}

/**
 * Providers that are an AGGREGATE of other books rather than a book.
 *
 * CFBD's `/lines` returns `consensus` alongside the individual books, and the
 * archive backfill stored it as if it were one of them — so
 * `consensusFromSnapshots` averages a blend against its own components. This
 * names them; it does not yet change the mean. See DQ-15 in docs/STATUS.md for
 * the measurement (6,029 games affected, the snapped line differs on 1,823 of
 * them) and the decision that is owed.
 */
export const AGGREGATE_PROVIDERS: ReadonlySet<string> = new Set(["consensus"]);

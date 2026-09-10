import Link from "next/link";
import type { Sport } from "../../lib/league";

/**
 * CFB / NFL, for a group that plays both.
 *
 * The two leagues do not share a calendar — NFL week 2 and CFB week 3 are the
 * same weekend, the NFL has a preseason and four playoff rounds, CFB has a
 * Week 0 and one bowl month — so a both-league group holds one week pointer
 * per league and this is how the reader says which one is in view. A link
 * carries no week: the number would mean something else on the other side.
 *
 * Shared by the pick'em hub (one board per league per week, 0042) and the
 * betting group's home (one sheet per league per week, GRP-12). Rendered as
 * nothing for a one-league group, so callers need no guard of their own.
 */
export function LeagueTabs({
  base,
  league,
  leagues,
  extra = {},
  all = false,
}: {
  /** Route the tabs sit on, e.g. `/groups/saturday-boys`. */
  base: string;
  /** The league in view. Null is the whole book, and only valid with `all`. */
  league: Sport | null;
  leagues: Sport[];
  /** Query params to keep across the switch — `?for=` while logging for a member. */
  extra?: Record<string, string | null>;
  /**
   * Offer "All" first, as the bare route (GRP-13). For a page whose natural
   * default is the whole book — a member's season — rather than one week,
   * which only ever exists on one league's calendar. Each league is then
   * `?league=cfb` / `?league=nfl` explicitly, since the bare route is taken.
   */
  all?: boolean;
}) {
  if (leagues.length < 2) return null;
  const hrefFor = (l: Sport | null): string => {
    const qs = new URLSearchParams();
    if (l !== null && (all || l === "nfl")) qs.set("league", l);
    for (const [k, v] of Object.entries(extra)) if (v) qs.set(k, v);
    const q = qs.toString();
    return q ? `${base}?${q}` : base;
  };
  const tabs: Array<Sport | null> = [
    ...(all ? [null] : []),
    ...(["cfb", "nfl"] as const).filter((l) => leagues.includes(l)),
  ];
  return (
    <nav aria-label="League" className="mb-3 flex items-center gap-1">
      {tabs.map((l) => (
        <Link
          key={l ?? "all"}
          href={hrefFor(l)}
          aria-current={league === l ? "page" : undefined}
          className={`stat flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold ${
            league === l ? "bg-accent/15 text-accent" : "text-dim hover:text-chalk"
          }`}
        >
          {l === null ? "All" : l.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}

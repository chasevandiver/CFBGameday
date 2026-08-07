"use client";

import { useMemo, useState } from "react";

export interface RatingRow {
  teamId: number;
  school: string;
  abbreviation: string | null;
  conference: string | null;
  color: string | null;
  logoUrl: string | null;
  overall: number;
  /**
   * Sub-ratings, on the same points-vs-average scale as `overall`, which they
   * sum to exactly. Higher is better for both: offense is points this team
   * scores above average, defense is points it takes off the opponent
   * (`priceGame`: `home.offense − away.defense`).
   */
  offense: number;
  defense: number;
  /** vs previous week; null preseason */
  delta: number | null;
  churn: number | null;
  luck: number | null;
  /** Human-poll rank ("#4 AP") — context only, ordering stays model rating */
  pollRank: number | null;
  poll: string | null;
}

type SortKey = "overall" | "offense" | "defense" | "delta" | "churn" | "luck";

const RATING_COL = {
  key: "overall" as const,
  label: "Rating",
  title: "Points vs average FBS team, neutral field",
};

/**
 * Off and Def render only when the stored halves actually differ.
 *
 * They were pulled entirely in the August audit (#11) because the pipeline
 * tracked overall alone and wrote `overall/2` twice — two identical numbers
 * presented as independent measurements. Since 2026.3.0 the halves carry the
 * replay and are real, so they come back, but the dishonest case still exists:
 * a preseason with no results yet has nothing to differentiate offense from
 * defense, and an even split would put the same fabricated pair back on screen.
 *
 * `splitInformative` (src/model/ratings.ts) is the gate, the same one that
 * decides whether a projected total is a prediction or a constant. Hiding the
 * columns is the honest state, not a degraded one.
 */
const SPLIT_COLS: Array<{ key: SortKey; label: string; title: string }> = [
  { key: "offense", label: "Off", title: "Points scored above an average FBS offense" },
  { key: "defense", label: "Def", title: "Points taken off an average FBS opponent — higher is better" },
];

const TAIL_COLS: Array<{ key: SortKey; label: string; title: string }> = [
  { key: "delta", label: "Δwk", title: "Movement vs last week" },
  { key: "churn", label: "Churn", title: "Preseason roster churn adjustment" },
  { key: "luck", label: "Luck", title: "Preseason luck regression (negative = was overachieving)" },
];

export function RatingsTable({
  rows,
  showSplit = false,
}: {
  rows: RatingRow[];
  /** Whether the stored off/def halves carry information — see SPLIT_COLS. */
  showSplit?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [descending, setDescending] = useState(true);
  const [conference, setConference] = useState<string | null>(null);

  const columns = useMemo(
    () => (showSplit ? [RATING_COL, ...SPLIT_COLS, ...TAIL_COLS] : [RATING_COL, ...TAIL_COLS]),
    [showSplit],
  );

  const conferences = useMemo(
    () =>
      [...new Set(rows.map((r) => r.conference).filter((c): c is string => c !== null))].sort(),
    [rows],
  );

  // Rank is always by overall, regardless of the active sort
  const rankById = useMemo(() => {
    const byOverall = [...rows].sort((a, b) => b.overall - a.overall);
    return new Map(byOverall.map((r, i) => [r.teamId, i + 1]));
  }, [rows]);

  const visible = useMemo(() => {
    const filtered = conference ? rows.filter((r) => r.conference === conference) : rows;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return descending ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  }, [rows, conference, sortKey, descending]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        <Chip label="All" active={conference === null} onClick={() => setConference(null)} />
        {conferences.map((c) => (
          <Chip key={c} label={c} active={conference === c} onClick={() => setConference(c)} />
        ))}
      </div>

      {/* scrollable panel so the header can stick — 136 rows without it lose
          the column labels three flicks in */}
      <div className="max-h-[75vh] overflow-auto rounded border border-chalk/10 bg-surface">
        <table className="stats w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-chalk/20 text-left text-xs uppercase text-chalk/60">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Team</th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="px-2 py-2 text-right"
                  aria-sort={
                    sortKey === c.key ? (descending ? "descending" : "ascending") : "none"
                  }
                >
                  <button
                    onClick={() => toggleSort(c.key)}
                    title={c.title}
                    className={`uppercase ${sortKey === c.key ? "text-accent" : "hover:text-chalk"}`}
                  >
                    {c.label}
                    {sortKey === c.key ? (descending ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.teamId} className="border-b border-chalk/5 last:border-0">
                <td className="px-2 py-1.5 text-chalk/50">{rankById.get(r.teamId)}</td>
                <td className="px-2 py-1.5 font-sans">
                  <span className="flex items-center gap-2">
                    {r.logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.logoUrl} alt="" className="h-4 w-4 shrink-0" loading="lazy" />
                    )}
                    <span className="truncate">{r.school}</span>
                    {r.pollRank !== null && r.poll && (
                      <span
                        className="stat shrink-0 text-[10px] text-chalk/40"
                        title={`${r.poll} rank`}
                      >
                        #{r.pollRank} {r.poll}
                      </span>
                    )}
                    <span className="hidden text-xs text-chalk/40 sm:inline">{r.conference}</span>
                  </span>
                </td>
                <NumCell value={r.overall} strong />
                {showSplit && (
                  <>
                    <NumCell value={r.offense} signed />
                    <NumCell value={r.defense} signed />
                  </>
                )}
                <td className="px-2 py-1.5 text-right">
                  {r.delta === null ? (
                    <span className="text-chalk/30">—</span>
                  ) : r.delta > 0 ? (
                    <span className="text-win">▲{r.delta.toFixed(1)}</span>
                  ) : r.delta < 0 ? (
                    <span className="text-loss">▼{Math.abs(r.delta).toFixed(1)}</span>
                  ) : (
                    <span className="text-chalk/40">·</span>
                  )}
                </td>
                <NumCell value={r.churn} />
                <NumCell value={r.luck} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-chalk/50">
        Ratings are points vs an average FBS team on a neutral field. Δwk fills in once
        in-season updates start; Churn and Luck are the preseason adjustments baked into the
        number.{" "}
        {showSplit ? (
          <>
            Off and Def are the same scale and sum to Rating — Off is points scored above an
            average offense, Def is points taken off the opponent, so higher is better for both.
          </>
        ) : (
          <>
            Off and Def are hidden: with no results yet the two halves are identical, and showing
            one number twice would not be two measurements.
          </>
        )}
      </p>
    </div>
  );
}

function NumCell({
  value,
  strong = false,
  signed = false,
}: {
  value: number | null;
  strong?: boolean;
  /** Off/Def are deviations from average, so the sign is the whole point. */
  signed?: boolean;
}) {
  return (
    <td className={`px-2 py-1.5 text-right ${strong ? "font-semibold" : "text-chalk/80"}`}>
      {value === null ? (
        <span className="text-chalk/30">—</span>
      ) : (
        `${signed && value > 0 ? "+" : ""}${value.toFixed(1)}`
      )}
    </td>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs ${
        active
          ? "border-accent bg-accent/15 text-accent"
          : "border-chalk/20 text-chalk/70 hover:border-chalk/50"
      }`}
    >
      {label}
    </button>
  );
}

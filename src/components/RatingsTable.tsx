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
  offense: number;
  defense: number;
  /** vs previous week; null preseason */
  delta: number | null;
  churn: number | null;
  luck: number | null;
}

type SortKey = "overall" | "offense" | "defense" | "delta" | "churn" | "luck";

const COLUMNS: Array<{ key: SortKey; label: string; title: string }> = [
  { key: "overall", label: "Rating", title: "Points vs average FBS team, neutral field" },
  { key: "offense", label: "Off", title: "Offense sub-rating" },
  { key: "defense", label: "Def", title: "Defense sub-rating" },
  { key: "delta", label: "Δwk", title: "Movement vs last week" },
  { key: "churn", label: "Churn", title: "Preseason roster churn adjustment" },
  { key: "luck", label: "Luck", title: "Preseason luck regression (negative = was overachieving)" },
];

export function RatingsTable({ rows }: { rows: RatingRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [descending, setDescending] = useState(true);
  const [conference, setConference] = useState<string | null>(null);

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

      <div className="overflow-x-auto rounded border border-chalk/10 bg-surface">
        <table className="stats w-full text-sm">
          <thead>
            <tr className="border-b border-chalk/20 text-left text-xs uppercase text-chalk/50">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Team</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-2 text-right">
                  <button
                    onClick={() => toggleSort(c.key)}
                    title={c.title}
                    className={`uppercase ${sortKey === c.key ? "text-gold" : "hover:text-chalk"}`}
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
                    <span className="hidden text-xs text-chalk/40 sm:inline">{r.conference}</span>
                  </span>
                </td>
                <NumCell value={r.overall} strong />
                <NumCell value={r.offense} />
                <NumCell value={r.defense} />
                <td className="px-2 py-1.5 text-right">
                  {r.delta === null ? (
                    <span className="text-chalk/30">—</span>
                  ) : r.delta > 0 ? (
                    <span className="text-gold">▲{r.delta.toFixed(1)}</span>
                  ) : r.delta < 0 ? (
                    <span className="text-flag">▼{Math.abs(r.delta).toFixed(1)}</span>
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
        number.
      </p>
    </div>
  );
}

function NumCell({ value, strong = false }: { value: number | null; strong?: boolean }) {
  return (
    <td className={`px-2 py-1.5 text-right ${strong ? "font-semibold" : "text-chalk/80"}`}>
      {value === null ? <span className="text-chalk/30">—</span> : value.toFixed(1)}
    </td>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs ${
        active
          ? "border-gold bg-gold/15 text-gold"
          : "border-chalk/20 text-chalk/70 hover:border-chalk/50"
      }`}
    >
      {label}
    </button>
  );
}

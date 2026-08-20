"use client";

import { useEffect, useRef, useState } from "react";
import { probSurge, type TeamView } from "../../lib/slate";

/**
 * Horizontal win-probability split in team colors, away on the left.
 *
 * The widths transition (700ms), so ordinary movement is already smooth;
 * Fun Mode's momentum surge (FUN-14) is the announcement on top — when the
 * split moves ≥8 points between updates, a shimmer sweeps toward whoever
 * gained. The shimmer element is display-gated in CSS, so with the toggle
 * off this renders exactly as before.
 */
export function WinProbBar({
  home,
  away,
  homeWinProb,
  height = 6,
  showLabels = true,
}: {
  home: TeamView;
  away: TeamView;
  homeWinProb: number;
  height?: number;
  showLabels?: boolean;
}) {
  const homePct = Math.round(homeWinProb * 100);
  const awayPct = 100 - homePct;
  const homeColor = home.color ?? "var(--push)";
  const awayColor = away.color ?? "var(--push)";

  const prev = useRef(homeWinProb);
  const [surge, setSurge] = useState<{ dir: "home" | "away"; key: number } | null>(null);
  useEffect(() => {
    const dir = probSurge(prev.current, homeWinProb);
    prev.current = homeWinProb;
    if (dir) setSurge({ dir, key: Date.now() });
  }, [homeWinProb]);
  useEffect(() => {
    if (!surge) return;
    const t = setTimeout(() => setSurge(null), 1000);
    return () => clearTimeout(t);
  }, [surge]);

  return (
    <div aria-label={`Win probability: ${away.abbr} ${awayPct}%, ${home.abbr} ${homePct}%`}>
      {showLabels && (
        <div className="stat mb-1 flex justify-between text-[10.5px] leading-none text-dim">
          <span>
            {away.abbr} <span className="font-semibold text-chalk">{awayPct}%</span>
          </span>
          <span>
            <span className="font-semibold text-chalk">{homePct}%</span> {home.abbr}
          </span>
        </div>
      )}
      <div
        className="relative flex w-full overflow-hidden rounded-full"
        style={{ height, background: "var(--line)" }}
      >
        <div
          className="h-full transition-[width] duration-700 ease-out"
          style={{ width: `${awayPct}%`, background: awayColor }}
        />
        <div className="h-full w-0.5 shrink-0 bg-background" />
        <div
          className="h-full flex-1 transition-[width] duration-700 ease-out"
          style={{ background: homeColor }}
        />
        {surge && <span key={surge.key} className="wp-shimmer" data-dir={surge.dir} aria-hidden />}
      </div>
    </div>
  );
}

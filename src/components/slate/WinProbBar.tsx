import type { TeamView } from "../../lib/slate";

/** Horizontal win-probability split in team colors, away on the left. */
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
  const homeColor = home.color ?? "#5b6472";
  const awayColor = away.color ?? "#9aa1ad";

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
        className="flex w-full overflow-hidden rounded-full"
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
      </div>
    </div>
  );
}

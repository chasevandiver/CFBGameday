import { buildBoxScore, type BoxScoreRow } from "../../lib/boxscore";
import { periodLabel } from "../../lib/kick";
import type { ScoringPlayRow } from "../../lib/scoring";
import type { TeamView } from "../../lib/slate";
import { TeamMark } from "../slate/TeamMark";

/**
 * The line score, in all three states of a game (owner request 2026-08-15).
 *
 * Pregame it is the empty grid with the kickoff under it — the section is part
 * of the page's furniture, and a box that appears only once a game starts makes
 * the page reflow at the exact moment someone is watching it. Live it fills a
 * column per quarter played, with the quarters still to come left blank rather
 * than zeroed, because 0 claims a quarter happened. Final it is complete.
 *
 * Derived from `scoring_plays` — see `lib/boxscore.ts` for why that is enough
 * and where it can disagree with the scoreboard.
 */
export function BoxScore({
  plays,
  home,
  away,
  homePoints,
  awayPoints,
  status,
  period,
  kickoff,
}: {
  plays: ScoringPlayRow[];
  home: TeamView;
  away: TeamView;
  homePoints: number | null;
  awayPoints: number | null;
  status: string;
  period: number | null;
  /** "Sat 3:30 PM CT" — the caption under an empty pregame grid. */
  kickoff: string | null;
}) {
  const box = buildBoxScore(plays, homePoints, awayPoints, status, period);
  const missing = box.home.unaccounted + box.away.unaccounted;
  const leader =
    box.started && box.home.total !== box.away.total
      ? box.home.total > box.away.total
        ? "home"
        : "away"
      : null;

  return (
    <section className="card mt-4 overflow-hidden" aria-labelledby="box-heading">
      <h2 id="box-heading" className="border-b border-chalk/8 px-4 py-2.5 text-sm text-accent">
        Box score
      </h2>

      {/* Wide games (double overtime) scroll the grid, never the page. */}
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[20rem] border-collapse text-sm">
          <caption className="sr-only">
            {away.school} at {home.school}, points by quarter
          </caption>
          <thead>
            <tr className="border-b border-chalk/8">
              <th scope="col" className="px-4 py-1.5 text-left">
                <span className="sr-only">Team</span>
              </th>
              {box.periods.map((n) => (
                <th
                  key={n}
                  scope="col"
                  className="stat w-9 px-1 py-1.5 text-center text-[10.5px] font-semibold uppercase tracking-wider text-chalk/55"
                >
                  {periodLabel(n)}
                </th>
              ))}
              <th
                scope="col"
                className="stat w-12 px-3 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wider text-chalk/55"
              >
                T
              </th>
            </tr>
          </thead>
          <tbody>
            <TeamLine team={away} row={box.away} dim={leader === "home"} started={box.started} />
            <TeamLine team={home} row={box.home} dim={leader === "away"} started={box.started} />
          </tbody>
        </table>
      </div>

      {!box.started && (
        <p className="border-t border-chalk/8 px-4 py-2 text-xs text-dim">
          {kickoff ? `Fills in from kickoff — ${kickoff}.` : "Fills in once the game starts."}
        </p>
      )}
      {/* Said out loud rather than hidden by parking the difference in the last
          quarter: the total is the scoreboard's, the quarters are the feed's,
          and when they disagree the reader should know which is which. */}
      {missing > 0 && (
        <p className="border-t border-chalk/8 px-4 py-2 text-xs text-dim">
          {missing} {missing === 1 ? "point" : "points"} in the totals aren&rsquo;t in any quarter
          yet — the feed hasn&rsquo;t published the play.
        </p>
      )}
    </section>
  );
}

function TeamLine({
  team,
  row,
  dim,
  started,
}: {
  team: TeamView;
  row: BoxScoreRow;
  /** The trailing side, once there is a leader. Matches the card's score rows. */
  dim: boolean;
  started: boolean;
}) {
  return (
    <tr className="border-b border-chalk/5 last:border-0">
      <th scope="row" className="px-4 py-2 text-left font-normal">
        <span className="flex min-w-0 items-center gap-2">
          <TeamMark team={team} size={20} />
          <span className={`truncate text-sm ${dim ? "text-dim" : "text-chalk"}`}>
            {team.abbr}
          </span>
        </span>
      </th>
      {row.cells.map((n, i) => (
        <td
          key={i}
          className={`stat px-1 py-2 text-center tabular-nums ${
            n === null ? "text-chalk/25" : dim ? "text-dim" : "text-chalk"
          }`}
        >
          {n === null ? "–" : n}
        </td>
      ))}
      <td
        className={`stat px-3 py-2 text-right text-base font-semibold tabular-nums ${
          !started ? "text-chalk/25" : dim ? "text-dim" : "text-chalk"
        }`}
      >
        {started ? row.total : "–"}
      </td>
    </tr>
  );
}

import { periodLabel } from "../../lib/kick";
import { byPeriod, type ScoringPlayRow } from "../../lib/scoring";
import type { TeamView } from "../../lib/slate";
import { TeamMark } from "../slate/TeamMark";

/**
 * Every score in the game, in order (SCORE-1).
 *
 * Owner request: "it'd say first quarter Texas WR (name) caught a 17 yard
 * touchdown from (name), Texas logo 7 Ohio State logo 0, with the time left in
 * the quarter. But do that for all scores in that game."
 *
 * So: quarter headings, then a line per score with its clock, the play as the
 * feed wrote it, and the running score after it. The play text is verbatim —
 * it already reads as a sentence in both feeds ("J.Slye 55 yard field goal is
 * GOOD, Center-M.Cox, Holder-T.Townsend.") and any attempt to re-word it would
 * be inventing detail the feed did not supply.
 *
 * ## Detail page only
 *
 * The request was "when you click into it", and that is also the right answer:
 * a timeline on a slate card would break the glanceable rule — someone picks up
 * the phone, gets an answer in under two seconds, puts it down. A scoring
 * history is the opposite kind of reading.
 *
 * ## The running score is stored, not accumulated
 *
 * Each row carries the score after it, straight from the feed. Summing points
 * in the browser would look equivalent and is not: a feed occasionally reports
 * a score whose play we never captured, and a computed total would then be
 * wrong for every row below it rather than for the one that is missing.
 */
export function ScoringTimeline({
  plays,
  home,
  away,
}: {
  plays: ScoringPlayRow[];
  home: TeamView;
  away: TeamView;
}) {
  if (plays.length === 0) return null;
  const periods = byPeriod(plays);

  return (
    <section className="card mt-4 overflow-hidden">
      <h2 className="border-b border-chalk/8 px-4 py-2.5 text-sm text-accent">Scoring</h2>

      {periods.map((p, i) => (
        <div key={`${p.period}-${i}`}>
          <h3 className="stat border-b border-chalk/5 bg-elev/40 px-4 py-1.5 text-[10.5px] uppercase tracking-wider text-chalk/55">
            {p.period === null ? "Other" : periodLabel(p.period)}
          </h3>
          <ul>
            {p.plays.map((s) => {
              const team =
                s.scoring_team_id === home.id ? home : s.scoring_team_id === away.id ? away : null;
              return (
                <li
                  key={s.sequence}
                  className="flex items-start gap-3 border-b border-chalk/5 px-4 py-2.5 last:border-0"
                >
                  {/* Fixed width whether or not a crest resolved, so the play
                      text starts on the same column down the whole list. */}
                  <span className="flex w-6 shrink-0 justify-center pt-0.5">
                    {team ? <TeamMark team={team} size={22} /> : null}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug text-chalk">{s.play_text}</span>
                    {s.clock && (
                      <span className="stat mt-0.5 block text-[10.5px] text-dim">
                        {s.clock}
                        {s.play_type ? ` · ${s.play_type}` : ""}
                      </span>
                    )}
                  </span>

                  {/* The score after the play, in the same tabular figures the
                      scorebug uses — a two-digit score must not shift the row
                      that follows it. */}
                  <span className="stat flex shrink-0 items-center gap-1.5 pt-0.5 text-sm font-semibold text-chalk">
                    <span className="text-dim">{away.abbr}</span>
                    <span>{s.away_points}</span>
                    <span className="text-chalk/25">·</span>
                    <span className="text-dim">{home.abbr}</span>
                    <span>{s.home_points}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

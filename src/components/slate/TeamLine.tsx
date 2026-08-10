import { displayRank, type TeamView } from "../../lib/slate";
import { TeamMark } from "./TeamMark";

/**
 * A team, said the way a broadcast lower-third says it: mark, rank, name,
 * record. One component so the slate, the group board, the matchup cards and
 * the admin's game picker all identify a team identically — before this the
 * group screens said "UGA at ALA" in plain text, which is the same information
 * a schedule PDF carries and none of the information a fan uses to pick.
 *
 * Everything past the mark is optional because the containers differ: a dense
 * admin checklist wants the abbreviation, a board card has room for the school.
 */

/**
 * The rank, and which body issued it.
 *
 * `displayRank` prefers the human poll and falls back to the model's own
 * rating rank, and those are very different claims — so the pip is only
 * accent-coloured when a poll actually ranked them, and the accessible name
 * always names the source. Unranked teams render nothing rather than a dash:
 * this sits inline with the team name, where a placeholder reads as a rank.
 */
export function RankPip({ team }: { team: TeamView }) {
  const rank = displayRank(team);
  if (rank === null || rank > 25) return null;
  const polled = team.pollRank !== null && team.poll !== null;
  const source = polled ? `${team.poll} rank` : "model rank";
  return (
    <span
      className={`stat shrink-0 text-[10.5px] font-semibold leading-none ${
        polled ? "text-accent" : "text-dim"
      }`}
      title={`#${rank} — ${source}`}
    >
      {/* The hash matters here in a way it doesn't on the slate card, where
          the rank is a superscript on the name: inline and followed by a
          record, a bare "2 Georgia 9-0" reads as three numbers in a row. */}
      <span aria-hidden>#{rank}</span>
      <span className="sr-only">
        number {rank} {source}
      </span>
    </span>
  );
}

/**
 * "8-1 · 5-1 conf". The overall record is the headline; the league record is
 * the one that says whether they're in the race, so it rides along dimmer
 * rather than in a second row that would cost a line of height on every card.
 */
export function TeamRecord({ team }: { team: TeamView }) {
  if (!team.record) return null;
  return (
    <span
      className="stat shrink-0 text-[10px] leading-none text-dim"
      title={
        team.confRecord
          ? `${team.record} overall, ${team.confRecord} in the ${team.conference ?? "conference"}`
          : `${team.record} overall`
      }
    >
      {team.record}
      {team.confRecord && <span className="text-chalk/40"> · {team.confRecord} conf</span>}
    </span>
  );
}

export function TeamLine({
  team,
  size = 24,
  /** `abbr` for dense rows, `school` where the card has the width. */
  name = "abbr",
  showRank = true,
  showRecord = true,
  className = "",
}: {
  team: TeamView;
  size?: number;
  name?: "abbr" | "school";
  showRank?: boolean;
  showRecord?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <TeamMark team={team} size={size} />
      {showRank && <RankPip team={team} />}
      <span className="scorebug min-w-0 truncate text-[15px] leading-tight text-chalk">
        {name === "school" ? team.school : team.abbr}
      </span>
      {showRecord && <TeamRecord team={team} />}
    </span>
  );
}

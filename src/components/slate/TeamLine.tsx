import type { ReactNode } from "react";
import { displayRank, type TeamView } from "../../lib/slate";
import { Football } from "./LiveSituation";
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
 *
 * `size` is the only thing that varies between the two places it appears.
 * `sm` is the dense rows — group boards, matchup cards, the admin picker —
 * where the rank is context beside an abbreviation. `md` is the scoreboard
 * row, where it leads the team name and has to survive being read at arm's
 * length in a dim room. Everything else is deliberately shared: one accent
 * rule, one source string, one way a rank is said.
 */
export function RankPip({ team, size = "sm" }: { team: TeamView; size?: "sm" | "md" }) {
  const rank = displayRank(team);
  if (rank === null || rank > 25) return null;
  const polled = team.pollRank !== null && team.poll !== null;
  const source = polled ? `${team.poll} rank` : "model rank";
  return (
    <span
      className={`stat shrink-0 font-semibold leading-none ${
        size === "md" ? "text-[13px]" : "text-[10.5px]"
      } ${polled ? "text-accent" : "text-dim"}`}
      title={`#${rank} — ${source}`}
    >
      {/* The hash carries the whole row: inline and followed by a record, a
          bare "2 Georgia 9-0" reads as three numbers in a row. It used to be
          droppable on the slate card, where the rank was a superscript hanging
          off the name — that card now leads with the pip like everything else,
          so there is no longer a place where the hash is optional. */}
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

/**
 * A team on its own row with its score, on the team-colour rail.
 *
 * The slate's game card has read this way since the cards were built: the mark
 * grows when there is a score to show, the school name sits on a coloured rail,
 * and the score is a 24px tabular number pinned to the right of the row. The
 * home hub used to stack a 10px "24–21" in the corner instead, which made the
 * most important number on a live row the smallest thing on it.
 *
 * **The rank leads the name rather than hanging off it (owner call,
 * 2026-08-19).** It was a 10px `text-dim` superscript *after* the school, which
 * is where a footnote goes — the eye reaches it having already read the name,
 * and at that size in a dim room it mostly did not survive the trip. A ranked
 * team is one of the two or three things that decides whether this game is
 * worth watching, so it now reads left to right in that order: "#2 Georgia".
 * It is the shared `RankPip` at `md` rather than markup of its own, which is
 * what buys the accent rule — accent when a poll ranked them, dim when it is
 * only the model's own rating — that the superscript never carried.
 *
 * So the construction lives here rather than inside `GameCard`, and both use
 * it. What stays in the card is what only the card has: the star button and the
 * score-flash animation, passed through `trailing` and `right`.
 *
 * The possession football used to be on that list, and no longer is (UX-37).
 * The hub had the data all along — `fetchHomeData` goes through
 * `fetchSlateView`, so `possession` is on its `GameView` too — but the football
 * lived inside the card's own `right` override and inside `FieldStrip`, which
 * `compact` mode drops. So a live row on the home page gave the down, the
 * distance and the last play and never said who had the ball. It is a prop
 * here now, rendered in one place for both callers.
 */
export function TeamScoreLine({
  team,
  score,
  showScore,
  dimmed = false,
  showRecord = true,
  trailing,
  right,
  hasBall = false,
}: {
  team: TeamView;
  /** Null renders 0 — a live game with no score yet is 0, not blank. */
  score: number | null;
  /** Live and final games show a score; everything else shows the record. */
  showScore: boolean;
  /** The losing side of a final, faded the way the slate fades it. */
  dimmed?: boolean;
  showRecord?: boolean;
  /** Card-only controls that sit inside the name row (the star button). */
  trailing?: ReactNode;
  /**
   * Replaces everything at the right edge of the row. The card passes its
   * animated score when there is one and its odds cells when there isn't;
   * omitting it gives the plain score, which is what the hub wants.
   */
  right?: ReactNode;
  /** This side has the ball. Only meaningful while a game is live (UX-37). */
  hasBall?: boolean;
}) {
  return (
    <div
      className={`trow flex items-center gap-2.5 transition-opacity ${dimmed ? "opacity-45" : ""}`}
      style={{ "--tc": team.color ?? "var(--push)" } as React.CSSProperties}
    >
      <span className="trail" aria-hidden />
      <TeamMark team={team} size={showScore ? 44 : 32} glow />
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        {/* Before the name, and never truncated: `shrink-0` on the pip means a
            long school name gives up characters before the rank gives up
            existing. */}
        <RankPip team={team} size="md" />
        <span
          className={`scorebug truncate leading-tight text-chalk ${showScore ? "text-[16.5px]" : "text-[15px]"}`}
        >
          {team.school}
        </span>
        {team.record && !showScore && showRecord && (
          <span className="stat shrink-0 text-[10px] leading-none text-dim">{team.record}</span>
        )}
        {trailing}
      </div>
      {hasBall && <Football label={`${team.school} has possession`} />}
      {right ??
        (showScore && (
          <span
            className={`stat w-11 shrink-0 text-right text-[24px] font-semibold leading-none ${
              dimmed ? "text-dim" : "text-chalk"
            }`}
          >
            {score ?? 0}
          </span>
        ))}
    </div>
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

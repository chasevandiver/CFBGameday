import { StatsStrip } from "./StatsStrip";
import type { GtgStats } from "../../lib/gtg-stats";
import { TeamMark, type MarkTeam } from "../slate/TeamMark";

/**
 * The two ways a round ends, and the only place the answer is ever drawn.
 *
 * A win arrives: the crest pops in over a gold burst that fades out behind
 * it, and the headline is the number of guesses it took, because that is the
 * thing worth telling somebody. A loss slides up from the bottom instead —
 * same information, arriving rather than celebrating.
 *
 * Both then hand off to the same stats strip. Whatever happened today, the
 * next screen is your record, which is the reason to come back tomorrow.
 */
export function EndState({
  solved,
  attempts,
  teams,
  fallbackAnswer,
  stats,
  mark,
  children,
}: {
  solved: boolean;
  attempts: number;
  teams: { away: string; home: string } | null;
  /** "Away @ Home", used only if the marks cannot be resolved. */
  fallbackAnswer: string | null;
  stats: GtgStats;
  mark: (school: string | undefined) => MarkTeam | null;
  /** The share button, owned by the container that holds the payload. */
  children?: React.ReactNode;
}) {
  const home = teams ? mark(teams.home) : null;

  return (
    <section className={solved ? "" : "gtg-slide-up"} aria-live="polite">
      {solved && (
        <div className="relative flex justify-center pt-2 pb-1">
          {/* Decorative, sized off the crest and fading out under it, so the
              burst never becomes a second thing to look at. */}
          <span aria-hidden className="gtg-burst absolute h-40 w-40 rounded-full" />
          {home ? (
            <span className="gtg-pop relative">
              <TeamMark team={home} size={88} glow />
            </span>
          ) : null}
        </div>
      )}

      <h2
        className={`display text-center text-2xl text-balance text-chalk ${solved ? "gtg-pop mt-3" : ""}`}
        style={solved ? { animationDelay: "160ms" } : undefined}
      >
        {solved ? `Solved in ${attempts}` : "Out of guesses"}
      </h2>

      {teams ? (
        <p className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {mark(teams.away) && <TeamMark team={mark(teams.away)!} size={26} />}
          <span className="font-sans text-sm text-chalk/75">{teams.away}</span>
          <span className="stat text-[11px] uppercase tracking-widest text-dim">at</span>
          {!solved && home && <TeamMark team={home} size={30} glow />}
          <span className="font-sans text-sm font-semibold text-chalk">{teams.home}</span>
        </p>
      ) : (
        fallbackAnswer && (
          <p className="mt-3 text-center font-sans text-sm font-semibold text-chalk">
            {fallbackAnswer}
          </p>
        )
      )}

      {children && <div className="mt-5 flex justify-center">{children}</div>}

      <StatsStrip stats={stats} solvedIn={solved ? attempts : null} />
    </section>
  );
}

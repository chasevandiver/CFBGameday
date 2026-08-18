import { TeamMark, type MarkTeam } from "../slate/TeamMark";

/**
 * The scoreboard, filling in as the round settles.
 *
 * Guess the Game's hero was the final score, because the score was the only
 * clue. Here the fixture is the hook and the score is the payoff, so the block
 * starts with two crests and two em-dashes and earns its numerals at the end.
 *
 * Two rules from DESIGN.md are doing visible work. The numerals sit in
 * `.scorebug` (condensed display face, tabular figures), so a 7 becoming a 10
 * does not move the hairline — and because the placeholder is the same class
 * at the same size, nothing shifts when the score finally lands either. And
 * the winner's side is marked with a rule rather than by moving anything.
 */
export function FixtureBug({
  home,
  away,
  homePoints,
  awayPoints,
  winner,
  caption,
}: {
  home: MarkTeam;
  away: MarkTeam;
  homePoints: number | null;
  awayPoints: number | null;
  winner: string | null;
  caption: string;
}) {
  return (
    <section className="card px-4 py-5" aria-label="The game">
      <p className="stat mb-4 text-center text-[10px] font-semibold uppercase tracking-widest text-chalk/45">
        {caption}
      </p>
      <div className="flex items-stretch">
        <Side team={away} value={awayPoints} label="Away" won={winner === away.school} />
        <div aria-hidden className="w-px shrink-0 self-stretch bg-chalk/15" />
        <Side team={home} value={homePoints} label="Home" won={winner === home.school} />
      </div>
    </section>
  );
}

function Side({
  team,
  value,
  label,
  won,
}: {
  team: MarkTeam;
  value: number | null;
  label: string;
  won: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 px-1">
      <TeamMark team={team} size={40} glow={won} />
      <span className="text-center text-sm text-chalk">{team.school}</span>
      {/* An em-dash rather than a blank: the slot has to hold its height, or
          the whole block jumps when the score arrives. */}
      <span className="scorebug text-6xl leading-none text-chalk">{value ?? "—"}</span>
      <span className="stat text-[10px] font-semibold uppercase tracking-widest text-dim">
        {won ? "Won" : label}
      </span>
    </div>
  );
}

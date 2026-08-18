import { gtgChips, type GtgChipState, type GtgStoredGuess } from "../../lib/guess-game";
import { TeamMark, type MarkTeam } from "../slate/TeamMark";

/**
 * One guess: crest, school, then three fixed-width verdict chips.
 *
 * Fixed width is the whole idea — the chips sit in the same three columns on
 * every row, so a column of gold reads down the list without being read
 * across it. That replaces the old single emoji square plus a trailing
 * "right conference", which said the same thing in prose and only for one of
 * the three verdicts.
 *
 * All three chips are real comparisons (GTG-9). A chip still renders its
 * third, indeterminate state where the server could not decide one — a team
 * with no home venue on file has no region — and that is deliberate: a dark
 * chip means "not this", which is a claim, and `gtgChips` will not make one
 * it cannot support.
 */
export function GuessRow({
  guess,
  mark,
  index,
}: {
  guess: GtgStoredGuess;
  mark: (school: string | undefined) => MarkTeam | null;
  /** Position in the list, for the stagger on the way in. */
  index: number;
}) {
  const name = guess.name;
  const team = mark(name);
  return (
    <li
      className="gtg-row-in flex min-h-11 items-center gap-2.5"
      style={{ animationDelay: `${Math.min(index, 5) * 40}ms` }}
    >
      {team ? <TeamMark team={team} size={24} /> : <span className="w-6 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 truncate font-sans text-sm text-chalk">{name}</span>
      <span className="flex shrink-0 gap-1">
        {gtgChips(guess).map((c) => (
          <Chip key={c.key} label={c.label} state={c.state} team={name} />
        ))}
      </span>
    </li>
  );
}

const CHIP_CLASS: Record<GtgChipState, string> = {
  hit: "border-accent bg-accent text-accent-ink",
  miss: "border-chalk/25 text-chalk/65",
  unknown: "border-dashed border-chalk/20 text-chalk/45",
};

const CHIP_SR: Record<GtgChipState, string> = {
  hit: "matches",
  miss: "does not match",
  unknown: "not compared",
};

function Chip({ label, state, team }: { label: string; state: GtgChipState; team: string }) {
  return (
    <span
      className={`stat flex h-6 w-12 items-center justify-center rounded-full border text-[9px] font-semibold uppercase ${CHIP_CLASS[state]}`}
    >
      <span aria-hidden>{label}</span>
      <span className="sr-only">
        {team} {label} {CHIP_SR[state]}
      </span>
    </span>
  );
}

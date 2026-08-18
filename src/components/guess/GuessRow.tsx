import { gtgChips, type GtgChipState, type GtgVerdict } from "../../lib/guess-game";
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
 * REGION and RECORD render in their third, indeterminate state on most rows.
 * The reason is in `gtgChips` and it is a data limit, not a style: the
 * payload carries no region or record for the team you named, and a dark chip
 * would be a claim we cannot make.
 */
export function GuessRow({
  name,
  verdict,
  mark,
  index,
}: {
  name: string;
  verdict: GtgVerdict;
  mark: (school: string | undefined) => MarkTeam | null;
  /** Position in the list, for the stagger on the way in. */
  index: number;
}) {
  const team = mark(name);
  return (
    <li
      className="gtg-row-in flex min-h-11 items-center gap-2.5"
      style={{ animationDelay: `${Math.min(index, 5) * 40}ms` }}
    >
      {team ? <TeamMark team={team} size={24} /> : <span className="w-6 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 truncate font-sans text-sm text-chalk">{name}</span>
      <span className="flex shrink-0 gap-1">
        {gtgChips(verdict).map((c) => (
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

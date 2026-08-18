import { Lock } from "lucide-react";
import { GTG_CLUE_SLOTS, type GtgHint } from "../../lib/guess-game";
import { TeamMark, type MarkTeam } from "../slate/TeamMark";

/**
 * All four clue slots, always — locked ones included.
 *
 * The old list rendered only what you had already bought, so the cost of a
 * wrong guess was invisible until after you spent it. Showing the labels
 * behind a lock turns a miss into a trade you can see: another guess gone,
 * the season revealed. That is the difference between a puzzle and a form.
 *
 * The score rung is not here — it is the scoreboard above. Slot `i` is
 * `hints[i + 1]` and unlocks at `attempts >= i + 1`; see `GTG_CLUE_SLOTS`.
 */
export function ClueSlots({
  hints,
  attempts,
  justUnlocked,
  mark,
}: {
  hints: GtgHint[];
  attempts: number;
  /** Slot index revealed by the guess just submitted, animated once. */
  justUnlocked: number | null;
  mark: (school: string | undefined) => MarkTeam | null;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {GTG_CLUE_SLOTS.map((slot, i) => {
        const hint = attempts >= i + 1 ? hints[i + 1] : undefined;
        const team = hint ? mark(hint.team) : null;
        return (
          <li
            key={slot.label}
            className="flex min-h-11 items-center gap-3 border-b border-chalk/8 last:border-0"
          >
            <span className="stat w-[92px] shrink-0 text-[10px] font-semibold uppercase tracking-wider text-chalk/45">
              {slot.label}
            </span>
            {hint ? (
              /* Keyed on the slot so the reveal plays once, when the element
                 that shows the value first appears, and never again on the
                 re-renders that follow. */
              <span
                className={`flex min-w-0 flex-1 items-center gap-2 ${
                  justUnlocked === i ? "gtg-unlock" : ""
                }`}
              >
                {team && <TeamMark team={team} size={20} />}
                <span className="text-sm break-words text-chalk">{hint.value}</span>
              </span>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Lock className="h-3.5 w-3.5 shrink-0 text-chalk/25" aria-hidden />
                {/* The dimmed bar stands in for the value at roughly its
                    width, so unlocking swaps text for text and the row height
                    never changes. */}
                <span aria-hidden className="h-2 flex-1 rounded-full bg-chalk/8" />
                <span className="sr-only">Locked. One wrong guess reveals it.</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

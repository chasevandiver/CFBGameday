/**
 * A row of answer buttons.
 *
 * Extracted from `SixPackForm`'s inner map, which is the only place this
 * pattern existed and is now one of several callers. Nothing about it is new:
 * same `min-h-11` (the 44px floor DESIGN.md makes non-negotiable), same
 * `aria-pressed`, same accent-fill-when-chosen against elevated-with-a-ring
 * when not.
 *
 * `flex-wrap` with `flex-1` is what lets two long school names and four short
 * bands both lay out without a per-caller decision — two choices take half the
 * width each, four wrap to two rows, and neither case needs a grid.
 */
export function ChoiceButtons({
  choices,
  value,
  onPick,
  disabled = false,
}: {
  choices: readonly string[];
  value?: string | null;
  onPick: (choice: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((c) => {
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onPick(c)}
            className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-60 ${
              active
                ? "bg-accent text-accent-ink"
                : "bg-elev text-chalk ring-1 ring-inset ring-chalk/12 hover:ring-accent/40"
            }`}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}

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
 * width each, four wrap to two rows, and neither case needs a grid. `min-w-0`
 * and `break-words` are what stop "Middle Tennessee" from pushing the row wider
 * than the screen: a flex child will not shrink below its content without the
 * first, and will not wrap a long word without the second.
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
            className={`min-h-11 min-w-0 flex-1 rounded-lg px-3 text-sm font-semibold break-words transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60 ${
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

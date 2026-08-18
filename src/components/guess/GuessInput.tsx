"use client";

import { matchSchools, type SchoolOption } from "../../lib/guess-game";
import { TeamMark, type MarkTeam } from "../slate/TeamMark";

/**
 * The guess box and its type-ahead, shared by the daily puzzle and practice.
 *
 * Lifted out of both components unchanged in behaviour — same ranking, same
 * absolutely-positioned list, same "tapping fills the box and stops there"
 * rule. Six guesses is not enough to spend one on a fat-finger, and a list
 * that pushes the rows below it down on every keystroke is the layout shift
 * DESIGN.md rules out.
 *
 * The state still lives in the caller; this owns nothing but the markup.
 */
export function GuessInput({
  id,
  value,
  onChange,
  onSubmit,
  picking,
  onPick,
  schools,
  spent,
  disabled,
  label,
  placeholder,
}: {
  /** Unique per instance — two of these can be on the screen at once. */
  id: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  picking: boolean;
  onPick: (school: string) => void;
  schools: SchoolOption[];
  /** Schools already guessed this round; re-guessing one wastes an attempt. */
  spent: Set<string>;
  disabled: boolean;
  label: string;
  placeholder: string;
}) {
  const suggestions = picking
    ? matchSchools(value, schools).filter((s) => !spent.has(s.school))
    : [];

  const markOf = (s: SchoolOption): MarkTeam => ({
    school: s.school,
    abbr: s.abbreviation ?? s.school.slice(0, 3).toUpperCase(),
    color: s.color,
    logo: s.logo_url,
  });

  return (
    <div className="relative flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={id}
        className="min-w-0 flex-1 rounded-lg border border-chalk/12 bg-elev px-3.5 py-3 text-sm text-chalk placeholder:text-chalk/35 focus:border-accent focus-visible:outline-2 focus-visible:outline-accent"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || value.trim().length < 2}
        className="stat min-h-11 shrink-0 rounded-lg bg-accent px-5 text-sm font-semibold uppercase tracking-wider text-accent-ink disabled:opacity-60"
      >
        Guess
      </button>

      {suggestions.length > 0 && (
        <ul
          id={id}
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-lg border border-chalk/15 bg-elev shadow-lg"
        >
          {suggestions.map((s) => (
            <li key={s.school} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => onPick(s.school)}
                className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm text-chalk hover:bg-chalk/10"
              >
                <TeamMark team={markOf(s)} size={20} />
                <span className="flex-1 truncate">{s.school}</span>
                {s.abbreviation && (
                  <span className="stat shrink-0 text-[11px] text-dim">{s.abbreviation}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

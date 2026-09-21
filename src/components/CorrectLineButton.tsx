"use client";

import { useState, useTransition } from "react";
import { correctBetLine } from "../app/actions/admin-wagers";
import { fmtSpread } from "../lib/slate";

/**
 * ADM-3's control: the number this bet was logged at, and a way to change it.
 *
 * Not armed like `DeleteWagerButton`, on purpose. Arming exists there because
 * a delete cannot be taken back; a correction can — the old row is archived,
 * and the control itself is the way back to the old number. What this needs
 * instead is for the operator to SEE the number before they change it, which
 * is why the current line is the affordance rather than a word like "edit".
 *
 * The verdict comes back from the server and is shown, because that is the
 * thing the operator is actually checking: "-3.5 → -3" is not the answer, "now
 * a push" is. A bet on a game that has not finished answers "open", which is
 * correct rather than a failure.
 */
export function CorrectLineButton({
  id,
  line,
  label,
  onDone,
}: {
  id: number;
  /** The bettor's number, as the ticket reads it. */
  line: number | null;
  /** What this row is, so a screen reader's button list is not twenty "edit"s. */
  label?: string;
  onDone?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(line === null ? "" : String(line));
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const field =
    "w-20 rounded-lg border border-chalk/25 bg-elev px-2 py-1 text-sm text-chalk placeholder:text-chalk/35 focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

  function save() {
    const next = Number(value);
    if (value.trim() === "" || !Number.isFinite(next)) {
      setError("Enter a number");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await correctBetLine(id, next);
      if (!res.ok) {
        setError(res.message ?? "Could not correct the line");
        return;
      }
      setEditing(false);
      // "open" rather than an em dash: a corrected bet on a game still to be
      // played has no verdict yet, and that is a state, not a blank.
      setSettled(res.result ?? "open");
      onDone?.();
    });
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setSettled(null);
          }}
          aria-label={`Correct the line on ${label ?? "this bet"} — currently ${line === null ? "none" : fmtSpread(line)}`}
          className="-mx-2 inline-flex min-h-11 items-center rounded px-2 text-xs text-dim underline hover:text-accent"
        >
          {line === null ? "set line" : fmtSpread(line)}
        </button>
        {/* Always mounted, the `ShareImageButton` pattern: a live region that
            appears at the same instant its content does is not reliably
            announced, and the confirmation is the whole point of the control.
            The visible copy is aria-hidden so it is not read twice. */}
        <span role="status" aria-live="polite" className="sr-only">
          {settled ? `now ${settled}` : ""}
        </span>
        {settled && (
          <span aria-hidden="true" className="text-xs text-dim">
            now {settled}
          </span>
        )}
      </span>
    );
  }

  return (
    /* `w-full` inside the row's flex-wrap: the form takes a line of its own
       rather than truncating the description it belongs to. `order-last` keeps
       it below the delete it sits beside when collapsed. */
    <span className="order-last flex w-full items-center gap-1.5">
      <input
        type="number"
        step="0.5"
        inputMode="decimal"
        name="line"
        /* Not an auth field, and a password manager offering to fill a point
           spread is noise on every row. */
        autoComplete="off"
        /* The justified case: one input, revealed by the operator tapping the
           number they came here to change. Without it the tap costs a second
           one. */
        autoFocus
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        aria-label={`New line for ${label ?? "this bet"}, as the ticket reads it`}
        className={field}
      />
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="-mx-1 inline-flex min-h-11 items-center rounded px-1 text-xs font-semibold text-accent underline disabled:opacity-50"
      >
        {pending ? "saving…" : "save"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setEditing(false);
          setError(null);
        }}
        className="-mx-1 inline-flex min-h-11 items-center rounded px-1 text-xs text-dim underline disabled:opacity-50"
      >
        cancel
      </button>
      {error && (
        <span role="alert" className="text-xs text-loss">
          {error}
        </span>
      )}
    </span>
  );
}

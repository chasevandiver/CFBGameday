"use client";

import { useState, useTransition } from "react";
import { submitSixPack } from "../app/actions/daily-games";

export interface SixPackFormQuestion {
  idx: number;
  text: string;
  choices: Array<{ value: string; label: string }>;
}

/**
 * The week's six answers, submitted together (R3-E2). One button per choice
 * at `min-h-11`; the submit is disabled until all six are answered, because
 * the RPC refuses a partial entry and a form that lets you send one is a form
 * that lies about what will happen.
 */
export function SixPackForm({
  slateId,
  questions,
  mine,
  locked,
}: {
  slateId: number;
  questions: SixPackFormQuestion[];
  /** Existing answers by idx, when you've already entered. */
  mine: Record<number, string>;
  locked: boolean;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>(mine);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const complete = questions.every((q) => answers[q.idx]);

  const submit = () => {
    if (!complete || locked) return;
    startTransition(async () => {
      setMessage(null);
      setSaved(false);
      const ordered = questions
        .slice()
        .sort((a, b) => a.idx - b.idx)
        .map((q) => answers[q.idx]!);
      const res = await submitSixPack(slateId, ordered);
      if (!res.ok) setMessage(res.message ?? "Something went wrong");
      else setSaved(true);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {questions.map((q) => (
        <div key={q.idx}>
          <p className="mb-1.5 text-sm text-chalk">
            <span className="stat mr-2 text-[10px] font-semibold uppercase tracking-wider text-chalk/45">
              {q.idx}
            </span>
            {q.text}
          </p>
          <div className="flex flex-wrap gap-2">
            {q.choices.map((c) => {
              const active = answers[q.idx] === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  disabled={locked || pending}
                  aria-pressed={active}
                  onClick={() => {
                    setSaved(false);
                    setAnswers((prev) => ({ ...prev, [q.idx]: c.value }));
                  }}
                  className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-60 ${
                    active
                      ? "bg-accent text-accent-ink"
                      : "bg-elev text-chalk ring-1 ring-inset ring-chalk/12 hover:ring-accent/40"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {!locked && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={!complete || pending}
            className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-60"
          >
            {saved ? "Entered ✓" : Object.keys(mine).length > 0 ? "Update entry" : "Enter"}
          </button>
          <span className="text-xs text-dim">
            {complete ? "Locks at the first kickoff." : "Answer all six to enter."}
          </span>
        </div>
      )}
      {locked && <p className="text-xs text-dim">Locked — the first game has kicked off.</p>}
      {message && <p className="text-xs text-loss">{message}</p>}
    </div>
  );
}

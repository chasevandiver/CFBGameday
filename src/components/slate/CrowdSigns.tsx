"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { setCrowdSign } from "../../app/actions/signs";
import { funOn, useFunPrefs } from "../../lib/fun-mode";

/**
 * Crowd signs (FUN-10): the wall behind the desk. One posterboard sign per
 * member per week (0075 — crew-visible, own-row writes, 80 chars), rendered
 * over the slate from Friday through Sunday for anyone running Fun Mode.
 * Compose and wall live together: write yours, see everyone's.
 */

export interface SignView {
  name: string;
  body: string;
  mine: boolean;
}

export function CrowdSigns({
  signs,
  seasonId,
  week,
  myName,
}: {
  signs: SignView[];
  seasonId: number;
  week: number;
  myName: string | null;
}) {
  const [prefs] = useFunPrefs();
  // Friday is for writing the sign; the weekend is for waving it.
  const [inWindow] = useState(() => {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).has("funday")) return true;
    const d = new Date().getDay();
    return d === 5 || d === 6 || d === 0;
  });
  const initialOwn = signs.find((s) => s.mine)?.body ?? "";
  const [draft, setDraft] = useState(initialOwn);
  const [saved, setSaved] = useState(initialOwn);
  const [note, setNote] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (!funOn(prefs, "signs") || !inWindow) return null;

  const wall = [
    ...(saved.trim() ? [{ name: myName || "You", body: saved.trim(), mine: true }] : []),
    ...signs.filter((s) => !s.mine),
  ];

  const save = () =>
    startTransition(async () => {
      const res = await setCrowdSign(seasonId, week, draft);
      if (res.ok) {
        setSaved(draft.trim());
        setNote(draft.trim() ? "On the wall." : "Taken down.");
      } else {
        setNote(res.message ?? "Could not save the sign");
      }
    });

  return (
    <section className="mb-5" aria-label="Crowd signs">
      {wall.length > 0 && (
        <ul className="flex flex-wrap items-start gap-3">
          {wall.map((s, i) => (
            <li
              key={`${s.name}-${i}`}
              className="fun-sign"
              style={{ "--sr": `${(i % 2 === 0 ? -1 : 1) * (0.8 + (i % 3) * 0.9)}deg` } as CSSProperties}
            >
              <span className="fun-sign-body">{s.body}</span>
              <span className="fun-sign-name">{s.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <label htmlFor="crowd-sign" className="sr-only">
          Your sign for week {week}
        </label>
        <input
          id="crowd-sign"
          type="text"
          maxLength={80}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Your sign for the wall — 80 characters of posterboard"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-chalk/15 bg-surface px-3 text-sm text-chalk placeholder:text-dim focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          onClick={save}
          disabled={busy || draft.trim() === saved}
          className="min-h-11 rounded-lg border border-chalk/15 px-3 text-sm font-medium text-chalk transition-colors hover:border-chalk/30 disabled:opacity-50"
        >
          {saved && draft.trim() === "" ? "Take it down" : "Put it up"}
        </button>
        {note && <span className="text-xs text-dim">{note}</span>}
      </div>
    </section>
  );
}

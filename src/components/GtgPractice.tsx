"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import {
  GTG_MAX_ATTEMPTS,
  matchSchools,
  type GtgHint,
  type GtgVerdict,
  type SchoolOption,
} from "../lib/guess-game";
import { TeamMark, type MarkTeam } from "./slate/TeamMark";

/**
 * Practice rounds — the archive, for fun, scored by nobody.
 *
 * Deliberately a separate component from `GuessGamePlay` rather than a mode
 * flag inside it. The daily puzzle's state lives in the database and is worth
 * points; this one lives in React and is worth nothing, and the two have
 * different rules about what a refresh means (the daily survives one, a
 * practice round does not). Folding them together would mean one component
 * holding two truths about where its own state lives.
 *
 * The round is held here and the seed goes to the server on every guess, which
 * is what keeps the answer off the client until it is over.
 */

const newSeed = () =>
  `p-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;

interface Played {
  name: string;
  verdict: GtgVerdict;
}

export function GtgPractice({ schools }: { schools: SchoolOption[] }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [hints, setHints] = useState<GtgHint[]>([]);
  const [played, setPlayed] = useState<Played[]>([]);
  const [guess, setGuess] = useState("");
  const [picking, setPicking] = useState(false);
  const [done, setDone] = useState(false);
  const [solved, setSolved] = useState(false);
  const [answerTeams, setAnswerTeams] = useState<{ away: string; home: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = useCallback(() => {
    const s = newSeed();
    setSeed(s);
    setHints([]);
    setPlayed([]);
    setGuess("");
    setPicking(false);
    setDone(false);
    setSolved(false);
    setAnswerTeams(null);
    setError(null);
    fetch(`/api/guess-game/practice?seed=${encodeURIComponent(s)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { hints?: GtgHint[]; error?: string }
          | null;
        if (!res.ok || !body || body.error) {
          setError(body?.error ?? "Couldn’t start a practice round");
          return;
        }
        setHints(body.hints ?? []);
      })
      .catch(() => setError("Couldn’t start a practice round"));
  }, []);

  const byName = new Map(schools.map((s) => [s.school, s]));
  const mark = (school: string | undefined): MarkTeam | null => {
    const o = school === undefined ? undefined : byName.get(school);
    if (!o) return null;
    return {
      school: o.school,
      abbr: o.abbreviation ?? o.school.slice(0, 3).toUpperCase(),
      color: o.color,
      logo: o.logo_url,
    };
  };

  const submit = () => {
    const g = guess.trim();
    if (!g || pending || done || seed === null) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/guess-game/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed, guess: g, attempts: played.length }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            name?: string;
            verdict?: GtgVerdict;
            hints?: GtgHint[];
            done?: boolean;
            solved?: boolean;
            answerTeams?: { away: string; home: string } | null;
            error?: string;
          }
        | null;
      if (!res.ok || !body || body.error) {
        setError(body?.error ?? "Something went wrong");
        return;
      }
      setPlayed((p) => [...p, { name: body.name ?? g, verdict: body.verdict ?? "miss" }]);
      setHints(body.hints ?? []);
      setDone(Boolean(body.done));
      setSolved(Boolean(body.solved));
      setAnswerTeams(body.answerTeams ?? null);
      setGuess("");
      setPicking(false);
    });
  };

  const cell = (v: GtgVerdict) => (v === "correct" ? "🟩" : v === "conference" ? "🟨" : "⬛");
  const spentNames = new Set(played.map((p) => p.name));
  const suggestions = picking
    ? matchSchools(guess, schools).filter((s) => !spentNames.has(s.school))
    : [];

  if (!open) {
    return (
      <button
        onClick={() => {
          // Opening IS starting — the round begins in the handler rather than
          // an effect watching `open`, which is both simpler and the shape the
          // react-hooks rules want.
          setOpen(true);
          start();
        }}
        className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-chalk/15 px-4 text-sm text-chalk hover:border-chalk/40"
      >
        Practice on another game
        <span className="stat text-[11px] text-dim">doesn’t count</span>
      </button>
    );
  }

  return (
    <section className="card mt-4 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm text-accent">Practice</h2>
        <button
          onClick={() => setOpen(false)}
          className="stat text-xs text-dim hover:text-chalk"
        >
          close
        </button>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-dim">
        A random game from the archive — never today’s. Nothing here is saved and nothing counts
        toward your points or the arcade. Play as many as you like.
      </p>

      {hints.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5">
          {hints.map((h) => (
            <li key={h.label} className="flex items-center gap-2 text-sm">
              <span className="stat w-[104px] shrink-0 text-[10px] font-semibold uppercase tracking-wider text-chalk/55">
                {h.label}
              </span>
              {mark(h.team) && <TeamMark team={mark(h.team)!} size={20} />}
              <span className="text-chalk">{h.value}</span>
            </li>
          ))}
        </ul>
      )}

      {played.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1">
          {played.map((p, i) => (
            <li key={i} className="flex min-h-8 items-center gap-2 text-sm">
              <span aria-hidden>{cell(p.verdict)}</span>
              {mark(p.name) && <TeamMark team={mark(p.name)!} size={22} />}
              <span className="font-sans text-chalk/80">{p.name}</span>
              {p.verdict === "conference" && (
                <span className="text-xs text-chalk/50">right conference</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {done ? (
        <div>
          <p className="text-sm text-chalk">{solved ? "Got it." : "Out of guesses."}</p>
          {answerTeams && (
            <p className="mt-2 flex flex-wrap items-center gap-2">
              {mark(answerTeams.away) && <TeamMark team={mark(answerTeams.away)!} size={30} />}
              <span className="font-sans text-sm text-chalk/80">{answerTeams.away}</span>
              <span className="stat text-xs text-dim">at</span>
              {mark(answerTeams.home) && (
                <TeamMark team={mark(answerTeams.home)!} size={34} glow />
              )}
              <span className="font-sans text-sm font-semibold text-chalk">{answerTeams.home}</span>
            </p>
          )}
          <button
            onClick={start}
            className="mt-3 flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Another one
          </button>
        </div>
      ) : (
        <>
          <div className="relative flex gap-2">
            <input
              value={guess}
              onChange={(e) => {
                setGuess(e.target.value);
                setPicking(true);
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Guess the home team"
              aria-label="Guess the home team (practice)"
              autoComplete="off"
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls="gtg-practice-suggestions"
              className="min-w-0 flex-1 rounded-lg border border-chalk/12 bg-elev px-3 py-2 text-sm text-chalk placeholder:text-chalk/35 focus:border-accent focus-visible:outline-2 focus-visible:outline-accent"
            />
            <button
              onClick={submit}
              disabled={pending || guess.trim().length < 2}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
            >
              Guess
            </button>

            {suggestions.length > 0 && (
              <ul
                id="gtg-practice-suggestions"
                role="listbox"
                className="absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-lg border border-chalk/15 bg-elev shadow-lg"
              >
                {suggestions.map((s) => (
                  <li key={s.school} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onClick={() => {
                        setGuess(s.school);
                        setPicking(false);
                      }}
                      className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm text-chalk hover:bg-chalk/10"
                    >
                      {mark(s.school) && <TeamMark team={mark(s.school)!} size={20} />}
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
          <p className="mt-2 text-xs text-dim">
            {GTG_MAX_ATTEMPTS - played.length} left — each miss buys a clue.
          </p>
        </>
      )}
      {error && <p className="mt-2 text-xs text-loss">{error}</p>}
    </section>
  );
}

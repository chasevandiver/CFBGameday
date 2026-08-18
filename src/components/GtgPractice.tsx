"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { type GtgHint, type GtgVerdict, type SchoolOption } from "../lib/guess-game";
import { ClueSlots } from "./guess/ClueSlots";
import { GuessInput } from "./guess/GuessInput";
import { GuessPips } from "./guess/GuessPips";
import { GuessRow } from "./guess/GuessRow";
import { GtgScoreboard } from "./guess/Scoreboard";
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
 *
 * It shares the daily puzzle's presentational parts (`./guess/`) and nothing
 * else. Practice sits directly under the real game on the same screen, so a
 * practice round that still looked like the old clue table would read as a
 * different product two thumb-scrolls down.
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

  const spentNames = new Set(played.map((p) => p.name));

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
        <>
          <GtgScoreboard hints={hints} />
          <div className="my-4 flex justify-center">
            <GuessPips used={played.length} />
          </div>
          <div className="mb-4">
            <ClueSlots
              hints={hints}
              attempts={played.length}
              justUnlocked={played.length > 0 ? played.length - 1 : null}
              mark={mark}
            />
          </div>
        </>
      )}

      {played.length > 0 && (
        <ul className="mb-4 flex flex-col gap-1.5">
          {played.map((p, i) => (
            <GuessRow key={i} index={i} name={p.name} verdict={p.verdict} mark={mark} />
          ))}
        </ul>
      )}

      {done ? (
        <div className="gtg-slide-up">
          <h3 className="display text-center text-xl text-chalk">
            {solved ? `Solved in ${played.length}` : "Out of guesses"}
          </h3>
          {answerTeams && (
            <p className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {mark(answerTeams.away) && <TeamMark team={mark(answerTeams.away)!} size={26} />}
              <span className="font-sans text-sm text-chalk/75">{answerTeams.away}</span>
              <span className="stat text-[11px] uppercase tracking-widest text-dim">at</span>
              {mark(answerTeams.home) && (
                <TeamMark team={mark(answerTeams.home)!} size={30} glow />
              )}
              <span className="font-sans text-sm font-semibold text-chalk">{answerTeams.home}</span>
            </p>
          )}
          <button
            onClick={start}
            className="stat mx-auto mt-5 flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold uppercase tracking-wider text-accent-ink"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Another one
          </button>
        </div>
      ) : (
        <GuessInput
          id="gtg-practice-suggestions"
          value={guess}
          onChange={(v) => {
            setGuess(v);
            setPicking(true);
          }}
          onSubmit={submit}
          picking={picking}
          onPick={(school) => {
            setGuess(school);
            setPicking(false);
          }}
          schools={schools}
          spent={spentNames}
          disabled={pending}
          label="Guess the home team (practice)"
          placeholder="Who was home?"
        />
      )}
      {error && <p className="mt-2 text-xs text-loss">{error}</p>}
    </section>
  );
}

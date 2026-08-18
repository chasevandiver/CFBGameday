"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import {
  GTG_MAX_ATTEMPTS,
  gtgShareBlock,
  type GtgStoredGuess,
  type SchoolOption,
} from "../lib/guess-game";
import { EMPTY_STATS, type GtgStats } from "../lib/gtg-stats";
import { ClueSlots } from "./guess/ClueSlots";
import { EndState } from "./guess/EndState";
import { GuessInput } from "./guess/GuessInput";
import { GuessPips } from "./guess/GuessPips";
import { GuessRow } from "./guess/GuessRow";
import { GtgScoreboard } from "./guess/Scoreboard";
import type { MarkTeam } from "./slate/TeamMark";

interface GtgState {
  day: string;
  attempts: number;
  maxAttempts: number;
  solved: boolean;
  done: boolean;
  guesses: GtgStoredGuess[];
  hints: Array<{ label: string; value: string; team?: string }>;
  answer: string | null;
  answerTeams: { away: string; home: string } | null;
  /** The caller's record across every day, folded server-side (GTG-10). */
  stats: GtgStats;
}

/**
 * The daily puzzle player (R2-C3). All state comes from /api/guess-game —
 * this component never sees the answer until the server says the game is
 * over, which is the whole anti-spoiler design.
 *
 * Redesigned as a game rather than a form: the score is the hero, the clue
 * slots are visible before you have bought them, and a guess reads as three
 * fixed chips instead of a coloured square and a sentence. Every piece below
 * is presentational and lives in `./guess/`.
 *
 * The payload now also carries the caller's standing (GTG-10) and each
 * guess's region and record marks (GTG-9), both computed server-side. The
 * component holds no derived state for either — a streak folded on the
 * client was the thing that made it device-local, and a chip recomputed on
 * the client would need the answer.
 */
export function GuessGamePlay({ schools }: { schools: SchoolOption[] }) {
  const [state, setState] = useState<GtgState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guess, setGuess] = useState("");
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  // Closed after a pick or a submit, so the list does not hang around over the
  // guess history once you have chosen.
  const [picking, setPicking] = useState(false);
  /* Which clue slot the last submit revealed. Set in the submit handler, not
     derived from `attempts`, because the flip must play on the guess that
     bought the clue and not on a reload three slots later — the attempt count
     alone cannot tell those two apart. */
  const [justUnlocked, setJustUnlocked] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/guess-game")
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | (GtgState & { error?: string })
          | null;
        if (cancelled) return;
        if (!res.ok || !body || body.error) {
          setError(body?.error ?? "Couldn’t load today’s puzzle");
        } else {
          setState(body);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn’t load today’s puzzle");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = () => {
    const g = guess.trim();
    if (!g || pending || !state || state.done) return;
    const before = state.attempts;
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/guess-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guess: g }),
      });
      const body = (await res.json().catch(() => null)) as
        | (GtgState & { error?: string })
        | null;
      if (!res.ok || !body || body.error) {
        setError(body?.error ?? "Something went wrong");
        return;
      }
      /* The clue this guess just bought, flipped open once. Read off the
         payload rather than an effect watching `attempts`, so a reload never
         replays a reveal that already happened. */
      if (body.attempts > before && body.attempts <= GTG_MAX_ATTEMPTS) {
        setJustUnlocked(body.attempts - 1);
      }
      setState(body);
      setGuess("");
      setPicking(false);
    });
  };

  const share = async () => {
    if (!state) return;
    const text = gtgShareBlock(state.day, state.guesses, state.solved, state.stats?.streak ?? 0);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied; nothing to fall back to */
    }
  };

  if (error && !state) return <p className="text-sm text-loss">{error}</p>;
  if (!state) return <p className="text-sm text-dim">Loading today’s puzzle…</p>;

  /* Crests come from the same school list the type-ahead uses, joined on the
     name the SERVER returned — `teams.school` on both sides, so it is an exact
     match rather than a fuzzy one. A school we somehow cannot find just
     renders without a mark; a missing logo is not worth a broken row. */
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
  // Already-guessed schools drop out: re-guessing one is a wasted attempt, and
  // the server would accept it.
  const spent = new Set(state.guesses.map((g) => g.name));

  return (
    <div className="flex flex-col gap-4">
      <GtgScoreboard hints={state.hints} />

      <div className="flex justify-center">
        <GuessPips used={state.attempts} />
      </div>

      <section className="card p-4">
        <ClueSlots
          hints={state.hints}
          attempts={state.attempts}
          justUnlocked={justUnlocked}
          mark={mark}
        />
      </section>

      <section className="card p-4">
        {state.guesses.length > 0 && (
          <ul className="mb-4 flex flex-col gap-1.5">
            {state.guesses.map((g, i) => (
              <GuessRow key={i} index={i} guess={g} mark={mark} />
            ))}
          </ul>
        )}

        {state.done ? (
          <EndState
            solved={state.solved}
            attempts={state.attempts}
            teams={state.answerTeams}
            fallbackAnswer={state.answer}
            stats={state.stats ?? EMPTY_STATS}
            mark={mark}
          >
            <button
              onClick={share}
              className="stat flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold uppercase tracking-wider text-accent-ink"
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
              {copied ? "Copied" : "Copy result"}
            </button>
          </EndState>
        ) : (
          <>
            <GuessInput
              id="gtg-suggestions"
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
              spent={spent}
              disabled={pending}
              label="Guess the home team"
              placeholder="Who was home?"
            />
            <p className="mt-2.5 text-center text-xs text-dim">
              School or abbreviation. Every miss unlocks the next clue.
            </p>
          </>
        )}
        {error && <p className="mt-2 text-xs text-loss">{error}</p>}
      </section>
    </div>
  );
}

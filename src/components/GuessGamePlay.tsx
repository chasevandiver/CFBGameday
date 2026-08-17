"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { GTG_MAX_ATTEMPTS, gtgShareString, type GtgVerdict } from "../lib/guess-game";

interface GtgState {
  day: string;
  attempts: number;
  maxAttempts: number;
  solved: boolean;
  done: boolean;
  guesses: Array<{ name: string; verdict: GtgVerdict }>;
  hints: Array<{ label: string; value: string }>;
  answer: string | null;
}

/**
 * The daily puzzle player (R2-C3). All state comes from /api/guess-game —
 * this component never sees the answer until the server says the game is
 * over, which is the whole anti-spoiler design.
 */
export function GuessGamePlay() {
  const [state, setState] = useState<GtgState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guess, setGuess] = useState("");
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

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
      setState(body);
      setGuess("");
    });
  };

  const share = async () => {
    if (!state) return;
    const text = gtgShareString(
      state.day,
      state.guesses.map((g) => g.verdict),
      state.solved,
    );
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

  const cell = (v: GtgVerdict) => (v === "correct" ? "🟩" : v === "conference" ? "🟨" : "⬛");

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4">
        <h2 className="mb-2 text-sm text-accent">The clues</h2>
        <ul className="flex flex-col gap-1.5">
          {state.hints.map((h) => (
            <li key={h.label} className="text-sm">
              <span className="stat mr-2 text-[10px] font-semibold uppercase tracking-wider text-chalk/55">
                {h.label}
              </span>
              <span className="text-chalk">{h.value}</span>
            </li>
          ))}
        </ul>
        {!state.done && (
          <p className="mt-2 text-xs text-dim">
            Each miss buys the next clue. {GTG_MAX_ATTEMPTS - state.attempts} left — who was the
            home team?
          </p>
        )}
      </section>

      <section className="card p-4">
        {state.guesses.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1">
            {state.guesses.map((g, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span aria-hidden>{cell(g.verdict)}</span>
                <span className="font-sans text-chalk/80">{g.name}</span>
                {g.verdict === "conference" && (
                  <span className="text-xs text-chalk/50">right conference</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {state.done ? (
          <div>
            <p className="text-sm text-chalk">
              {state.solved ? "Got it." : "Out of guesses."}{" "}
              <span className="font-semibold">{state.answer}</span>
            </p>
            <button
              onClick={share}
              className="mt-3 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
            >
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy result"}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Guess the home team — e.g. Auburn"
              aria-label="Guess the home team"
              className="min-w-0 flex-1 rounded-lg border border-chalk/12 bg-elev px-3 py-2 text-sm text-chalk placeholder:text-chalk/35 focus:border-accent focus-visible:outline-2 focus-visible:outline-accent"
            />
            <button
              onClick={submit}
              disabled={pending || guess.trim().length < 2}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
            >
              Guess
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-loss">{error}</p>}
      </section>
    </div>
  );
}

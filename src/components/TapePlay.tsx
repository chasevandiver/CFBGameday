"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { TAPE_QUESTIONS, tapeShareBlock, type TapeAnswer } from "../lib/tape";
import { EMPTY_DAILY, type DailyStats } from "../lib/daily-stats";
import { ChoiceButtons } from "./daily/ChoiceButtons";
import { FixtureBug } from "./daily/FixtureBug";
import { Pips } from "./daily/Pips";
import type { MarkTeam } from "./slate/TeamMark";

interface TapeState {
  day: string;
  /** Practice only: which stored round this is. */
  practiceId?: number;
  fixture: {
    season: number;
    week: number;
    seasonType: string;
    neutralSite: boolean;
    homeSchool: string;
    awaySchool: string;
    homeTeamId: number;
    awayTeamId: number;
  };
  answered: number;
  total: number;
  current: { idx: number; prompt: string; choices: string[] } | null;
  history: Array<{ idx: number; prompt: string; yours: string; answer: string; correct: boolean }>;
  bug: { winner: string | null; homePoints: number | null; awayPoints: number | null };
  done: boolean;
  correct: number | null;
  stats: DailyStats;
}

/**
 * The Tape's player (TAPE-2).
 *
 * Every piece of state comes from /api/tape. The component never holds the
 * answer key, never grades anything, and never sees a question it has not
 * reached — the route ships one at a time, so "no going back" is not a rule
 * this component has to keep, it is a shape it cannot escape.
 *
 * That is deliberate rather than incidental. `GuessGamePlay`'s equivalent note
 * says the same thing about the answer, and the reason is the same one: state
 * a client derives is state a client can be talked out of.
 */
export function TapePlay({
  crests: initialCrests,
  practice = false,
}: {
  /** Crest art by team id, so the fixture reads the way the rest of the app draws one. */
  crests: Record<number, { school: string; abbr: string; color: string | null; logo: string | null }>;
  /**
   * Unscored mode (PRAC-1). The only differences are the endpoint and who holds
   * progress — the practice route returns the SAME payload shape, which is why
   * this is a flag rather than a second component. A near-copy of a board is how
   * practice ends up practising a slightly different game.
   */
  practice?: boolean;
}) {
  const endpoint = practice ? "/api/tape/practice" : "/api/tape";
  /* Practice is stateless on the server, so the choices live here and are
     re-graded server-side on every submit. Safe because nothing is scored. */
  const [choices, setChoices] = useState<string[]>([]);
  const [crests, setCrests] = useState(initialCrests);
  const [state, setState] = useState<TapeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  /* Which question just landed, so its result can play in rather than appear.
     Held rather than derived from `answered`, because the animation belongs to
     the answer that was submitted, not to the count. */
  const [justAnswered, setJustAnswered] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetch(endpoint)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (!live) return;
        if (ok) {
          setState(body as TapeState);
          if ((body as { crests?: typeof initialCrests }).crests) {
            setCrests((body as { crests: typeof initialCrests }).crests);
          }
        } else {
          setError((body as { error?: string }).error ?? "Could not load the round");
        }
      })
      .catch(() => live && setError("Could not load the round"));
    return () => {
      live = false;
    };
  }, [endpoint]);

  const answer = (choice: string) => {
    if (!state?.current || pending) return;
    const idx = state.current.idx;
    const next = [...choices, choice];
    setError(null);
    startTransition(async () => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          practice
            ? { id: state.practiceId, choices: next }
            : { idx, choice },
        ),
      });
      const body = await res.json();
      if (res.ok) {
        setJustAnswered(idx);
        if (practice) setChoices(next);
        setState(body as TapeState);
      } else {
        setError((body as { error?: string }).error ?? "That did not go through");
      }
    });
  };

  /** A fresh unscored round. Practice only. */
  const nextRound = () => {
    setChoices([]);
    setJustAnswered(null);
    setError(null);
    startTransition(async () => {
      const res = await fetch(endpoint);
      const body = await res.json();
      if (res.ok) {
        setState(body as TapeState);
        if ((body as { crests?: typeof initialCrests }).crests) {
          setCrests((body as { crests: typeof initialCrests }).crests);
        }
      }
    });
  };

  if (error && !state) {
    return (
      <div className="card px-6 py-12 text-center">
        <p className="display text-lg text-chalk/80">{error}</p>
      </div>
    );
  }
  if (!state) {
    return <div className="skeleton h-64 w-full rounded-xl" aria-hidden />;
  }

  const team = (id: number, fallback: string): MarkTeam => {
    const c = crests[id];
    return {
      school: c?.school ?? fallback,
      /* TeamMark's monogram fallback reads the abbreviation, so an empty string
         is the honest input when we have none — it falls through to the school
         name rather than rendering "null". */
      abbr: c?.abbr ?? "",
      color: c?.color ?? null,
      logo: c?.logo ?? null,
    };
  };

  const f = state.fixture;
  const answersForShare: TapeAnswer[] = state.history.map((h) => ({
    idx: h.idx,
    choice: h.yours,
    correct: h.correct,
  }));

  return (
    <div className="flex flex-col gap-4">
      <FixtureBug
        home={team(f.homeTeamId, f.homeSchool)}
        away={team(f.awayTeamId, f.awaySchool)}
        homePoints={state.bug.homePoints}
        awayPoints={state.bug.awayPoints}
        winner={state.bug.winner}
        caption={`${f.season} · ${f.seasonType === "postseason" ? "Postseason" : `Week ${f.week}`}${
          f.neutralSite ? " · Neutral site" : ""
        }`}
      />

      <div className="flex items-center justify-between gap-3">
        <Pips total={TAPE_QUESTIONS} used={state.answered} label="questions answered" />
        {state.done && (
          <span className="stat text-sm text-chalk">
            {state.correct}
            <span className="text-dim">/{TAPE_QUESTIONS}</span>
          </span>
        )}
      </div>

      {/* Answered questions, oldest first, each showing what you said and what
          it was. A round you got wrong should still teach you the game. */}
      {state.history.length > 0 && (
        <ol className="flex flex-col gap-2">
          {state.history.map((h) => (
            <li
              key={h.idx}
              className={`card px-3 py-2.5 ${h.idx === justAnswered ? "gtg-row-in" : ""}`}
            >
              <p className="text-xs text-dim">{h.prompt}</p>
              <p className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                <span className={h.correct ? "text-win" : "text-loss"}>{h.yours}</span>
                {!h.correct && <span className="stat text-xs text-dim">was {h.answer}</span>}
              </p>
            </li>
          ))}
        </ol>
      )}

      {state.current && (
        <section className="card gtg-unlock px-4 py-4" aria-live="polite">
          <p className="mb-2.5 text-sm text-chalk">
            <span className="stat mr-2 text-[10px] font-semibold uppercase tracking-wider text-chalk/45">
              {state.current.idx + 1}
            </span>
            {state.current.prompt}
          </p>
          <ChoiceButtons choices={state.current.choices} onPick={answer} disabled={pending} />
        </section>
      )}

      {error && (
        <p className="text-xs text-loss" role="alert">
          {error}
        </p>
      )}

      {state.done && practice && (
        <section className="card gtg-slide-up px-4 py-5 text-center">
          <p className="display text-lg text-chalk">
            {state.correct === TAPE_QUESTIONS
              ? "Clean sheet"
              : `${state.correct} of ${TAPE_QUESTIONS}`}
          </p>
          <p className="mt-1 text-xs text-dim">Practice — nothing recorded.</p>
          <button
            type="button"
            onClick={nextRound}
            disabled={pending}
            className="mt-4 min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-ink transition-opacity focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40"
          >
            Another round
          </button>
        </section>
      )}

      {state.done && !practice && (
        <section className="card gtg-slide-up px-4 py-5 text-center">
          <p className="display text-lg text-chalk">
            {state.correct === TAPE_QUESTIONS
              ? "Clean sheet"
              : `${state.correct} of ${TAPE_QUESTIONS}`}
          </p>
          <div className="mt-3 flex items-center justify-center gap-4 text-xs text-dim">
            <span className="stat">Streak {state.stats.streak}</span>
            <span className="stat">Best {state.stats.bestStreak}</span>
            <span className="stat">
              {state.stats.won}/{state.stats.played} clean
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(tapeShareBlock(state.day, answersForShare, state.stats.streak))
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
            }}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-elev px-4 text-sm font-semibold text-chalk ring-1 ring-inset ring-chalk/12 hover:ring-accent/40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? "Copied" : "Share"}
          </button>
        </section>
      )}
    </div>
  );
}

export { EMPTY_DAILY };

"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { DC_MISTAKES, dcShareBlock, type DcGrid, type DcVerdict } from "../lib/depth-chart";
import { Pips } from "./daily/Pips";
import { TeamMark, type MarkTeam } from "./slate/TeamMark";

interface SolvedGroup {
  id: string;
  label: string;
  teamIds: number[];
  byPlayer: boolean;
}

interface DcState {
  day: string;
  /** Practice only: which stored board this is. */
  practiceId?: number;
  tiles: number[];
  solved: SolvedGroup[];
  mistakes: number;
  maxMistakes: number;
  guesses: Array<{ teamIds: number[]; verdict: DcVerdict }>;
  done: boolean;
  won: boolean;
  stats: { streak: number; bestStreak: number; played: number; won: number };
  lastVerdict?: DcVerdict;
}

/**
 * Depth Chart's board (DC-2).
 *
 * Four rows of four, tap to select, submit when you have four. A solved group
 * lifts out of the grid and stacks above it, so the board shrinks as you go —
 * which is the whole feedback loop: sixteen tiles is daunting, eight is a
 * puzzle you can hold in your head.
 *
 * The component never knows a grouping it has not been told. The route reveals
 * a group only once it is solved or the board is lost, so there is nothing here
 * to leak — the same structural guarantee the other two games rely on.
 */
export function DepthChartPlay({
  crests: initialCrests,
  practice = false,
}: {
  crests: Record<number, { school: string; abbr: string; color: string | null; logo: string | null }>;
  /**
   * Unscored mode (PRAC-1). These boards come out of the same generator and the
   * same validator as the dailies, so a practice board is exactly as fair — the
   * only differences are the endpoint and that nothing is recorded.
   */
  practice?: boolean;
}) {
  const endpoint = practice ? "/api/depth-chart/practice" : "/api/depth-chart";
  /* Every four submitted so far. Practice replays them server-side, so which
     groups are solved is the server's conclusion rather than a client claim. */
  const [submitted, setSubmitted] = useState<number[][]>([]);
  const [crests, setCrests] = useState(initialCrests);
  const [state, setState] = useState<DcState | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<DcVerdict | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(endpoint)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (!live) return;
        if (ok) {
          setState(body as DcState);
          if ((body as { crests?: typeof initialCrests }).crests) {
            setCrests((body as { crests: typeof initialCrests }).crests);
          }
        } else {
          setError((body as { error?: string }).error ?? "Could not load the board");
        }
      })
      .catch(() => live && setError("Could not load the board"));
    return () => {
      live = false;
    };
  }, [endpoint]);

  const toggle = (id: number) => {
    if (pending || state?.done) return;
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : prev.length >= 4 ? prev : [...prev, id],
    );
  };

  const submit = () => {
    if (picked.length !== 4 || pending || !state) return;
    const practiceId = state.practiceId;
    setError(null);
    startTransition(async () => {
      const nextGuesses = [...submitted, picked];
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          practice
            ? { id: practiceId, guesses: nextGuesses }
            : { teamIds: picked },
        ),
      });
      const body = await res.json();
      if (res.ok) {
        const next = body as DcState;
        if (practice) setSubmitted(nextGuesses);
        setState(next);
        setPicked([]);
        if (next.lastVerdict && next.lastVerdict !== "correct") {
          setFlash(next.lastVerdict);
          setTimeout(() => setFlash(null), 1600);
        }
      } else {
        setError((body as { error?: string }).error ?? "That did not go through");
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
  if (!state) return <div className="skeleton h-96 w-full rounded-xl" aria-hidden />;

  const team = (id: number): MarkTeam => {
    const c = crests[id];
    return {
      school: c?.school ?? `#${id}`,
      abbr: c?.abbr ?? "",
      color: c?.color ?? null,
      logo: c?.logo ?? null,
    };
  };

  const gridForShare: DcGrid = {
    groups: state.solved.map((g) => ({ id: g.id, label: g.label, teamIds: g.teamIds })),
    tiles: [],
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Solved groups stack above the board, newest last, so the grid shrinks
          under them. */}
      {state.solved.map((g) => (
        <section key={g.id} className="card gtg-pop px-3 py-2.5">
          <p className="text-center text-sm font-semibold text-accent">{g.label}</p>
          <p className="mt-1 text-center text-xs text-dim">
            {g.teamIds.map((t) => team(t).school).join(" · ")}
          </p>
          {!g.byPlayer && (
            <p className="stat mt-1 text-center text-[10px] uppercase tracking-widest text-dim">
              Not solved
            </p>
          )}
        </section>
      ))}

      {state.tiles.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {state.tiles.map((id) => {
            const active = picked.includes(id);
            const t = team(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                disabled={pending || state.done}
                aria-pressed={active}
                className={`flex min-h-[4.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60 ${
                  active
                    ? "bg-accent text-accent-ink"
                    : "bg-elev text-chalk ring-1 ring-inset ring-chalk/12 hover:ring-accent/40"
                }`}
              >
                <TeamMark team={t} size={22} />
                {/* A tile is ~80px wide and "Southern Mississippi" is not. Two
                    lines then an ellipsis, so a long name shortens the label
                    rather than the grid. */}
                <span className="line-clamp-2 w-full text-[11px] leading-tight font-semibold break-words">
                  {t.school}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Pips
          total={DC_MISTAKES}
          used={state.mistakes}
          label="mistakes used"
          lastIsLoss
        />
        {!state.done && (
          <button
            type="button"
            onClick={submit}
            disabled={picked.length !== 4 || pending}
            className="min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-ink transition-opacity focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40"
          >
            Submit
          </button>
        )}
      </div>

      {/* "One away" is the feedback that teaches: your read was right and one
          tile was the trap, which is different information from "no". */}
      {flash && (
        <p className="gtg-pop text-center text-sm text-chalk" role="status">
          {flash === "one_away" ? "One away" : "Not those four"}
        </p>
      )}
      {error && (
        <p className="text-xs text-loss" role="alert">
          {error}
        </p>
      )}

      {state.done && (
        <section className="card gtg-slide-up px-4 py-5 text-center">
          <p className="display text-lg text-chalk">
            {state.won
              ? state.mistakes === 0
                ? "Perfect board"
                : `Cleared it, ${state.mistakes} off`
              : "Out of mistakes"}
          </p>
          {practice && (
            <>
              <p className="mt-1 text-xs text-dim">Practice — nothing recorded.</p>
              <button
                type="button"
                onClick={() => {
                  setSubmitted([]);
                  setPicked([]);
                  setError(null);
                  startTransition(async () => {
                    const res = await fetch(endpoint);
                    const body = await res.json();
                    if (res.ok) {
                      setState(body as DcState);
                      if ((body as { crests?: typeof initialCrests }).crests) {
                        setCrests((body as { crests: typeof initialCrests }).crests);
                      }
                    }
                  });
                }}
                disabled={pending}
                className="mt-4 min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-ink transition-opacity focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40"
              >
                Another board
              </button>
            </>
          )}
          <div className={`mt-3 flex items-center justify-center gap-4 text-xs text-dim${practice ? " hidden" : ""}`}>
            <span className="stat">Streak {state.stats.streak}</span>
            <span className="stat">Best {state.stats.bestStreak}</span>
            <span className="stat">
              {state.stats.won}/{state.stats.played} cleared
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  dcShareBlock(
                    state.day,
                    gridForShare,
                    {
                      solved: state.solved.filter((g) => g.byPlayer).map((g) => g.id),
                      mistakes: state.mistakes,
                      guesses: state.guesses,
                      completed_at: "done",
                    },
                    state.stats.streak,
                  ),
                )
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

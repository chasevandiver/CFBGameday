"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { funOn, overriddenGameday, useFunPrefs, type GamedayKind } from "../../lib/fun-mode";
import { isFinal, isLive, type GameView, type SlateData } from "../../lib/slate";

/**
 * The Sign-Off (FUN-16): the Cover's evening twin, and the Gameday Arc's
 * closing beat. The Cover opens the day; late on a gameday night, once
 * finals are on the board, this closes it — "That was Saturday." — the way
 * a broadcast signs off before the anthem.
 *
 * Same toggle as the Cover (`cover`: the bookends are one ritual), same
 * once-per-gameday stamp, same `/api/slate` diet. Shows only after 9pm
 * local with at least one final and nothing left on the schedule that the
 * viewer would rather be watching — a live game always outranks a goodnight.
 * `?funday=sat&daypart=lights` poses it on any Tuesday without stamping.
 *
 * Everything it says is computable tonight: pick'em grades land with
 * Sunday's job, so the day's personal line counts ACTION, never results —
 * "you had a piece of 6 of them" is true at midnight; a record would be a
 * guess wearing a number.
 */

const SEEN_KEY = "slate-signoff-seen";

function stampFor(kind: GamedayKind, d: Date): string {
  return `${kind}:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function closestFinal(finals: GameView[]): GameView | null {
  let best: GameView | null = null;
  let margin = Infinity;
  for (const g of finals) {
    const m = Math.abs((g.homePoints ?? 0) - (g.awayPoints ?? 0));
    if (m < margin) {
      margin = m;
      best = g;
    }
  }
  return best;
}

/** A final where the poll's clear favorite lost — tonight's upset. */
function upsetFinal(finals: GameView[]): GameView | null {
  for (const g of finals) {
    const h = g.homePoints ?? 0;
    const a = g.awayPoints ?? 0;
    const winner = h > a ? g.home : a > h ? g.away : null;
    const loser = h > a ? g.away : a > h ? g.home : null;
    if (!winner || !loser) continue;
    const wr = winner.pollRank ?? 99;
    const lr = loser.pollRank ?? 99;
    if (lr <= 15 && wr - lr >= 10) return g;
  }
  return null;
}

function FinalLine({ g }: { g: GameView }) {
  const h = g.homePoints ?? 0;
  const a = g.awayPoints ?? 0;
  return (
    <span className="scorebug text-3xl text-chalk sm:text-4xl">
      {g.away.abbr} <span className={a > h ? "" : "text-chalk/50"}>{a}</span>
      <span className="mx-2 text-chalk/30">–</span>
      <span className={h > a ? "" : "text-chalk/50"}>{h}</span> {g.home.abbr}
    </span>
  );
}

export function SignOff() {
  const [prefs] = useFunPrefs();
  const [slate, setSlate] = useState<SlateData | null>(null);
  const [kind, setKind] = useState<GamedayKind>(null);
  const [preview, setPreview] = useState(false);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const on = funOn(prefs, "cover");

  useEffect(() => {
    if (!on) return;
    const now = new Date();
    const search = new URLSearchParams(window.location.search);
    const day = overriddenGameday(search, now);
    if (!day) return;
    // Late evening for real; a posed `?daypart=lights` is evening enough.
    const isPreview = search.has("funday") || search.has("daypart");
    const evening = search.get("daypart") === "lights" || now.getHours() >= 21;
    if (!evening) return;
    if (!isPreview) {
      try {
        if (localStorage.getItem(SEEN_KEY) === stampFor(day, now)) return;
      } catch {
        /* private mode: show it, the stamp just won't stick */
      }
    }
    let alive = true;
    (async () => {
      const res = await fetch(`/api/slate?sport=${day}`);
      if (!res.ok) return;
      const data = (await res.json()) as SlateData;
      if (!alive) return;
      const finals = data.games.filter(isFinal);
      const live = data.games.filter(isLive);
      // A goodnight while a game is on would be wrong twice over.
      if (finals.length === 0 || live.length > 0) return;
      setSlate(data);
      setKind(day);
      setPreview(isPreview);
      setOpen(true);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [on]);

  const dismiss = useCallback(() => {
    setOpen(false);
    if (!preview && kind) {
      try {
        localStorage.setItem(SEEN_KEY, stampFor(kind, new Date()));
      } catch {
        /* private mode */
      }
    }
  }, [preview, kind]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, dismiss]);

  if (!open || !slate || !kind) return null;

  const finals = slate.games.filter(isFinal);
  const tightest = closestFinal(finals);
  const upset = upsetFinal(finals);
  const headline = upset ?? tightest;
  const headlineWord = upset ? "The upset" : "The closest call";
  const myActionCount = slate.games.filter(
    (g) => isFinal(g) && (g.myPicks.length > 0 || g.myBets.length > 0),
  ).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="The sign-off"
      className="brand-surface bg-background fade-swap fixed inset-0 z-[80] flex flex-col overflow-y-auto"
      onClick={dismiss}
      style={{
        paddingTop: "max(env(safe-area-inset-top), 20px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 20px)",
      }}
    >
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6">
        <header className="pt-6 text-center">
          <p className="stat text-[10px] uppercase tracking-[0.24em] text-dim">
            The sign-off · {kind === "nfl" ? "Sunday" : "Saturday"}
          </p>
          <h1 className="mt-3 text-5xl leading-none text-chalk sm:text-6xl">
            That was {kind === "nfl" ? "Sunday" : "Saturday"}.
          </h1>
          <div className="mx-auto mt-5 w-full border-t-2 border-accent/80" aria-hidden />
          <div className="mx-auto mt-[3px] w-full border-t border-chalk/20" aria-hidden />
        </header>

        <section className="flex flex-1 flex-col justify-center py-10 text-center">
          {headline && (
            <>
              <p className="stat text-[10px] uppercase tracking-[0.24em] text-accent">
                {headlineWord}
              </p>
              <div className="mt-4">
                <FinalLine g={headline} />
              </div>
            </>
          )}
          <p className="stat mt-8 text-sm text-chalk">
            {finals.length} {finals.length === 1 ? "final" : "finals"}
            {myActionCount > 0 && <> · you had a piece of {myActionCount}</>}
          </p>
          <p className="stat mt-1.5 text-xs text-dim">
            {kind === "cfb" ? "Grades land with Sunday's numbers — the recap tells the whole story." : "The recap tells the whole story."}
          </p>
        </section>

        <footer className="pb-4 text-center">
          <div className="mx-auto w-full border-t border-chalk/20" aria-hidden />
          <button
            ref={closeRef}
            onClick={dismiss}
            className="mt-4 min-h-11 w-full rounded-lg border border-chalk/25 px-4 text-sm font-semibold text-chalk transition-colors hover:border-chalk/50"
          >
            Lights out
          </button>
        </footer>
      </div>
    </div>
  );
}

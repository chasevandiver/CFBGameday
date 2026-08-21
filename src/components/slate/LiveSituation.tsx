/**
 * The live situation block: down and distance, the ball on the field, and the
 * last play.
 *
 * Extracted from `GameCard` so the home hub can show the same thing. It was
 * the slate's alone, which meant a position row on the front page said
 * "Q3 · 8:42" and stopped — no down, no spot, no play — while the same game
 * one tap away said all three (owner report 2026-08-14). One implementation,
 * because "what is happening in this game right now" should not have two
 * answers depending on which screen you are looking at.
 */

"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { EMPTY_TRAIL, foldTrail, type TrailState } from "../../lib/drive-trail";
import { playAge, showsScore } from "../../lib/slate";
import { breakLabel } from "../../lib/kick";
import {
  fieldPosition,
  isRedZone,
  parseSituation,
  type FieldPosition,
  type GameView,
} from "../../lib/slate";

/** A TD flood order from the card's score detector (FUN-13). */
export interface EzFlood {
  side: "home" | "away";
  key: number;
}

/* Ghost-dot opacity by age, newest first — the drive fades behind the ball. */
const GHOST_O = [0.45, 0.32, 0.22, 0.14];

const DOWN = ["", "1st", "2nd", "3rd", "4th"];

/** Possession marker — a tiny football, unmistakable at a glance. */
export function Football({ label }: { label?: string }) {
  return (
    <svg
      width="17"
      height="11"
      viewBox="0 0 17 11"
      role="img"
      aria-label={label ?? "has possession"}
      className="shrink-0"
    >
      <ellipse cx="8.5" cy="5.5" rx="7.8" ry="4.7" fill="#9A6430" stroke="#5C3A18" strokeWidth="0.8" />
      <path
        d="M5.4 5.5h6.2M6.9 4.2v2.6M8.5 4.2v2.6M10.1 4.2v2.6"
        stroke="#F4EFE6"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FieldStrip({
  game,
  pos,
  redZone,
  flood,
  trail,
}: {
  game: GameView;
  pos: FieldPosition;
  redZone: boolean;
  /** Fun Mode (FUN-13): flood this side's end zone for the TD just scored. */
  flood: EzFlood | null;
  /** Fun Mode (FUN-14): prior observed ball spots this drive, oldest first. */
  trail: number[];
}) {
  return (
    <div className="field-strip" aria-hidden>
      <span
        key={flood?.side === "away" ? flood.key : "ez-l"}
        data-flood={flood?.side === "away" ? "" : undefined}
        className="field-ez field-ez-l"
        style={{ background: game.away.color ?? "var(--push)" }}
      />
      <span
        key={flood?.side === "home" ? flood.key : "ez-r"}
        data-flood={flood?.side === "home" ? "" : undefined}
        className="field-ez field-ez-r"
        style={{ background: game.home.color ?? "var(--push)" }}
      />
      {redZone && <span className={`field-rz ${pos.dir === "right" ? "field-rz-r" : "field-rz-l"}`} />}
      {trail.map((x, i) => (
        <span
          key={`gh-${x}-${i}`}
          className="field-ghost"
          style={
            {
              left: `${x}%`,
              "--gh-o": GHOST_O[Math.min(trail.length - 1 - i, GHOST_O.length - 1)],
            } as CSSProperties
          }
        />
      ))}
      <span className="field-ball" style={{ left: `${pos.x}%` }}>
        {pos.dir === "left" && <span className="field-dir">◂</span>}
        <Football />
        {pos.dir === "right" && <span className="field-dir">▸</span>}
      </span>
    </div>
  );
}

/**
 * Tier-3 information: the broadcast situation line, then the field strip —
 * the ball at its true yard line so danger reads spatially. Both fail closed
 * to the raw situation string when parsing is ambiguous.
 *
 * `compact` drops the field strip and keeps the words. The hub's position rows
 * are a list, not a set of cards, and a 12px playing field in every row reads
 * as decoration; the slate is where the game gets the space to be a game.
 */
export function LiveSituation({
  game,
  compact = false,
  flood = null,
}: {
  game: GameView;
  compact?: boolean;
  /** Fun Mode (FUN-13): forwarded from GameCard's score detector. */
  flood?: EzFlood | null;
}) {
  const sit = parseSituation(game.situation);
  const pos = fieldPosition(game);
  /* LIVE-4. Client-only and on its own clock, for two reasons: the server's
     `now` and the browser's would disagree at hydration, and — the reason it
     matters — the card only re-renders when data arrives. An age computed at
     render would freeze at the very moment it becomes worth reading, which is
     precisely when nothing is arriving. `playAge` returns the same string for
     most ticks, and setting identical state is a no-op in React, so the
     30-second interval costs a Date.parse. */
  /* One clock, driving both the play's age (LIVE-4) and whether the score has
     held the bottom line long enough (LIVE-7). Null until mount: the server
     and the browser would not agree on `now`, and a boolean that disagrees at
     hydration is a React error rather than a cosmetic one. Before the first
     tick the card renders exactly what it rendered before LIVE-7 — the score,
     when there is one — so the pre-mount frame is never wrong, only older. */
  const [nowMs, setNowMs] = useState<number | null>(null);
  const playAt = game.lastPlayAt ?? null;
  useEffect(() => {
    // The clock is the external system being subscribed to; the zero-delay
    // first tick keeps the effect body free of a synchronous setState while
    // still settling on the render after mount rather than 30s later.
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  /* No age during a break. At halftime the last play IS twelve minutes old and
     that is the game, not a fault — and the card is already saying HALFTIME
     beside it, so the badge would be answering a question nobody asked with a
     number that looks like an alarm. Same between quarters. */
  const atBreak = breakLabel(game.period, game.clock) !== null;
  // Boolean(), not `!== null`: a caller that omits `lastScore` entirely passes
  // undefined, and `undefined !== null` would put the card into score mode
  // with no score to render — a blank line where the play should be. Two
  // existing tests caught exactly that.
  const showScore = nowMs === null ? Boolean(game.lastScore) : showsScore(game, nowMs);
  const age = playAt && !atBreak && !showScore && nowMs !== null ? playAge(playAt, nowMs) : null;
  const redZone = isRedZone(game);
  const posTeam =
    game.possession === "home" ? game.home : game.possession === "away" ? game.away : null;

  /* Drive trail (FUN-14): fold each observed spot into per-instance history,
     using the adjust-state-during-render pattern — foldTrail returns the
     SAME object when nothing moved, so this settles in one extra render
     exactly when the ball does move and never loops. */
  const [trailState, setTrailState] = useState<TrailState>(EMPTY_TRAIL);
  const px = pos?.x ?? null;
  const folded = px !== null ? foldTrail(trailState, px, game.possession) : trailState;
  if (folded !== trailState) setTrailState(folded);
  // History excluding the ball's current spot (the last fold entry).
  const xs = folded.xs;
  const trail = xs.length > 0 && xs[xs.length - 1] === px ? xs.slice(0, -1) : xs;
  /* The last play counts as a situation on its own.
     ESPN publishes a down and distance only when there is a snap pending, so
     it goes null for the whole dead-ball stretch after a touchdown — through
     the PAT and the kickoff — and at end of quarter and on timeouts between
     possessions. Possession goes null with it, so `pos` is null too, and this
     guard used to drop the entire block. The play that just scored the
     touchdown is the one play on the card anybody wants to read, and it was
     the one play guaranteed not to render. */
  if (!game.situation && !pos && !game.lastPlay && !game.lastScore) return null;

  return (
    <div className={compact ? "mt-1.5" : "mt-2.5"}>
      {/* skipped entirely in the dead-ball state, rather than left as an empty
          flex row above the play */}
      {(game.situation || redZone) && (
        /* `live-sit` + --tc are Fun Mode's hooks (FUN-4): inert by default,
           restyled into a broadcast lower third under html[data-fun-broadcast]. */
        <div
          className="live-sit flex flex-wrap items-center gap-1.5"
          style={{ "--tc": posTeam?.color ?? undefined } as CSSProperties}
        >
          {sit ? (
            <span className="stat text-[12.5px] font-semibold text-chalk">
              {sit.down === 4 ? (
                <span className="down4">
                  {DOWN[sit.down]} &amp; {sit.distance === "Goal" ? "Goal" : sit.distance}
                </span>
              ) : (
                <>
                  {DOWN[sit.down]} &amp; {sit.distance === "Goal" ? "Goal" : sit.distance}
                </>
              )}
              <span className="font-medium text-dim">
                {" "}
                at {sit.sideToken ? `${sit.sideToken} ` : ""}
                {sit.yardLine}
              </span>
            </span>
          ) : game.situation ? (
            <span className="stat text-[12.5px] font-medium text-chalk">
              {posTeam ? `${posTeam.abbr} ball · ` : ""}
              {game.situation}
            </span>
          ) : null}
          {redZone && <span className="chip bg-loss/15 text-loss">Red zone</span>}
        </div>
      )}
      {pos && !compact && (
        <FieldStrip game={game} pos={pos} redZone={redZone} flood={flood} trail={trail} />
      )}
      {/* NFL-18. Once a game has scored, this line shows the SCORE and keeps
          showing it; before that it shows the last play.
          `lastPlay` is whatever ESPN published a moment ago, and after a
          touchdown that is the extra point within about thirty seconds and the
          kickoff a few after — so a reader glancing down a minute later got a
          kickoff where the touchdown had been. The live state is not lost: the
          down, distance, spot and field strip above are all current, and they
          are the part that changes every snap. This line is the part worth
          remembering.
          Two lines tall either way — a one-line play must not make the card
          shorter than its neighbours and then grow on the next snap
          (DESIGN.md: no layout shift on updates). */}
      {(game.lastScore || game.lastPlay) && (
        <p className="last-play">
          <span className="stat mr-1 text-[9px] font-semibold uppercase tracking-widest text-chalk/55">
            {showScore ? (game.lastScore?.abbr ?? "Score") : "Last"}
          </span>
          {showScore ? game.lastScore?.text : game.lastPlay}
          {/* LIVE-4. Only when the play is old enough that its age is news —
              see playAge. It rides inside the same paragraph so it cannot add
              a line, and `tabular-nums` keeps 9m and 10m the same width, so a
              minute ticking over moves nothing (DESIGN.md: no layout shift on
              updates). Absent for a score line: that one is meant to persist,
              and an age on it would read as staleness rather than memory. */}
          {age && (
            <span className="stat ml-1 text-[9px] tabular-nums text-chalk/45" title="Time since this play arrived">
              {age}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

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

import {
  fieldPosition,
  isRedZone,
  parseSituation,
  type FieldPosition,
  type GameView,
} from "../../lib/slate";

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
}: {
  game: GameView;
  pos: FieldPosition;
  redZone: boolean;
}) {
  return (
    <div className="field-strip" aria-hidden>
      <span className="field-ez field-ez-l" style={{ background: game.away.color ?? "var(--push)" }} />
      <span className="field-ez field-ez-r" style={{ background: game.home.color ?? "var(--push)" }} />
      {redZone && <span className={`field-rz ${pos.dir === "right" ? "field-rz-r" : "field-rz-l"}`} />}
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
export function LiveSituation({ game, compact = false }: { game: GameView; compact?: boolean }) {
  const sit = parseSituation(game.situation);
  const pos = fieldPosition(game);
  const redZone = isRedZone(game);
  const posTeam =
    game.possession === "home" ? game.home : game.possession === "away" ? game.away : null;
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
        <div className="flex flex-wrap items-center gap-1.5">
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
      {pos && !compact && <FieldStrip game={game} pos={pos} redZone={redZone} />}
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
            {game.lastScore ? (game.lastScore.abbr ?? "Score") : "Last"}
          </span>
          {game.lastScore ? game.lastScore.text : game.lastPlay}
        </p>
      )}
    </div>
  );
}

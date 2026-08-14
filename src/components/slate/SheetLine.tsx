"use client";

import { Flame, Snowflake, Ticket } from "lucide-react";
import { useBetSlip, type SlipSelection } from "../../lib/bet-slip-store";
import { betSideLabel, fmtMoneyline, fmtSpread, fmtTotal, type GameView } from "../../lib/slate";
import type { GroupBetView } from "../../lib/tailing";

/**
 * Who in your betting group has money on this game, and who got there first.
 *
 * This is the money answer to the question `CrewSplit` answers for the pool,
 * and it is deliberately a different shape. A pool split is symmetric — two
 * sides, count them. A sheet is a *timeline*: somebody put the number up and
 * everybody else reacted to it, and that ordering is the only thing that makes
 * "tail" and "fade" mean anything. So the source leads the row, followers
 * hang off it, and the arrow points from the reaction back to the bet it was a
 * reaction to.
 *
 * The tail button copies the source's side onto your slip at the number *you*
 * can get, not the one they got. Copying their line would produce a ledger row
 * you never actually held and a CLV against a price nobody offered you.
 */
export function SheetLine({ game }: { game: GameView }) {
  const { toggle } = useBetSlip();
  const bets = game.groupBets;
  if (bets.length === 0) return null;

  const sources = bets.filter((b) => b.relation === "origin");
  const followers = bets.filter((b) => b.relation === "tail" || b.relation === "fade");
  const iAmIn = bets.some((b) => b.isViewer);

  return (
    <div className="pointer-events-auto mt-2 border-t border-chalk/8 pt-2">
      <div className="mb-1 flex items-center gap-1.5">
        <Ticket size={10} aria-hidden className="shrink-0 text-accent" />
        <span className="stat text-[10px] font-semibold uppercase tracking-wider text-chalk/45">
          Sheet
        </span>
        {followers.length > 0 && (
          <span className="stat text-[10px] text-chalk/35">
            {followers.filter((f) => f.relation === "tail").length} tailing ·{" "}
            {followers.filter((f) => f.relation === "fade").length} fading
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {sources.map((s) => (
          <li key={s.betId} className="flex flex-col gap-0.5">
            <Position bet={s} game={game} />
            {followers
              .filter((f) => f.betType === s.betType)
              .map((f) => (
                <span key={f.betId} className="flex items-center gap-1 pl-3">
                  <span aria-hidden className="stat text-[10px] text-chalk/25">
                    ↳
                  </span>
                  <Position bet={f} game={game} />
                </span>
              ))}
          </li>
        ))}
      </ul>

      {/* One tap from "Jeff's on UGA" to a slip with UGA on it. Hidden once
          you already have a position on this game — the answer to "should I
          tail" is moot when you've already bet it. */}
      {!iAmIn && game.myBets.length === 0 && sources.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {sources.map((s) => {
            const sel = selectionFor(game, s);
            if (!sel) return null;
            return (
              <button
                key={s.betId}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggle(sel);
                }}
                className="stat inline-flex min-h-11 items-center gap-1 rounded-lg border border-accent/50 bg-accent/10 px-2.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20"
              >
                Tail {s.name.split(" ")[0]} · {sel.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One member's position: name, form, side, and what they are to the source. */
function Position({ bet, game }: { bet: GroupBetView; game: GameView }) {
  const label = betSideLabel(bet.betType, bet.side, bet.line, game.home.abbr, game.away.abbr);
  const graded = bet.result === "win" || bet.result === "loss";
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
      <span
        className={`truncate font-medium ${bet.isViewer ? "text-accent" : "text-chalk/85"}`}
      >
        {bet.isViewer ? "You" : bet.name}
      </span>
      {bet.form !== "level" && (
        <span
          className={`shrink-0 ${bet.form === "hot" ? "text-edge" : "text-push"}`}
          title={bet.form === "hot" ? "Hot: +3 or better over their last 10" : "Cold: −3 or worse over their last 10"}
        >
          {bet.form === "hot" ? (
            <Flame size={10} aria-hidden />
          ) : (
            <Snowflake size={10} aria-hidden />
          )}
          <span className="sr-only">{bet.form}</span>
        </span>
      )}
      <span
        className={`stat shrink-0 ${
          graded
            ? bet.result === "win"
              ? "text-win"
              : "text-loss"
            : "text-chalk"
        }`}
      >
        {label}
      </span>
      <span className="stat shrink-0 text-[10px] text-chalk/35">
        {bet.units}u
        {bet.record && ` · ${bet.record}`}
      </span>
      {bet.relation === "origin" ? (
        <span
          className="stat shrink-0 text-[10px] uppercase tracking-wider text-accent/70"
          title="First in the group on this market — the source"
        >
          first
        </span>
      ) : (
        <span className="stat shrink-0 truncate text-[10px] text-chalk/35">
          {bet.relation === "tail" ? "tailed" : "faded"} {bet.sourceName?.split(" ")[0]}
        </span>
      )}
    </span>
  );
}

/**
 * The slip selection a tail produces: their side, today's number.
 *
 * Returns null for anything the slate cannot price right now — a market with
 * no current line, or a bet type the odds cells don't offer. A tail button
 * that adds a selection with a stale or invented number is worse than no tail
 * button, because the ledger row it writes looks exactly like a real one.
 */
function selectionFor(game: GameView, b: GroupBetView): SlipSelection | null {
  const side = b.side;
  // `bets.side` is a free text column, so the four the slip understands have
  // to be checked rather than asserted.
  if (side !== "home" && side !== "away" && side !== "over" && side !== "under") return null;
  const matchup = `${game.away.abbr} @ ${game.home.abbr}`;
  const team = side === "home" ? game.home : game.away;
  const common = {
    gameId: game.id,
    matchup,
    kickTs: game.startTs,
    tailedFrom: b.name,
    away: { abbr: game.away.abbr, logo: game.away.logo, color: game.away.color },
    home: { abbr: game.home.abbr, logo: game.home.logo, color: game.home.color },
    // A tail inherits the number, not the conviction: how strongly someone else
    // liked it is their read, not yours.
    tier: "bet" as const,
  };

  if (b.betType === "spread") {
    const { spread } = game.lines;
    if (spread === null) return null;
    const theirs = side === "home" ? spread : -spread;
    return {
      ...common,
      betType: "spread",
      side,
      label: `${team.abbr} ${fmtSpread(theirs)}`,
      description: `${team.school} ${fmtSpread(theirs)} (${matchup})`,
      line: theirs,
      odds: -110,
    };
  }
  if (b.betType === "total") {
    const { total } = game.lines;
    if (total === null) return null;
    const over = side === "over";
    return {
      ...common,
      betType: "total",
      side,
      label: `${over ? "O" : "U"} ${fmtTotal(total)}`,
      description: `${over ? "Over" : "Under"} ${fmtTotal(total)} (${matchup})`,
      line: total,
      odds: -110,
    };
  }
  if (b.betType === "moneyline") {
    const ml = side === "home" ? game.lines.mlHome : game.lines.mlAway;
    if (ml === null) return null;
    return {
      ...common,
      betType: "moneyline",
      side,
      label: `${team.abbr} ML`,
      description: `${team.school} ML ${fmtMoneyline(ml)} (${matchup})`,
      line: null,
      odds: ml,
    };
  }
  return null;
}

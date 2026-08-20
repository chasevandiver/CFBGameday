"use client";

import type { CSSProperties } from "react";
import { funOn, useFunPrefs, useGameday } from "../../lib/fun-mode";
import type { GameView, TeamView } from "../../lib/slate";

/**
 * Pennants (FUN-6): on a gameday the teams you follow — profile favorites and
 * starred teams — hang over the slate as felt pennants in their own colors.
 * Tapping one pins that team's game to the Focus row, so the decoration is
 * also the fastest way to set up your Saturday.
 */
export function PennantRow({
  games,
  starred,
  favoriteTeamIds,
  onFocus,
}: {
  games: GameView[];
  starred: number[];
  favoriteTeamIds: number[];
  onFocus: (gameId: number) => void;
}) {
  const [prefs] = useFunPrefs();
  const gameday = useGameday();
  if (!funOn(prefs, "pennants") || !gameday) return null;

  const wanted = new Set([...starred, ...favoriteTeamIds]);
  const entries: { team: TeamView; gameId: number }[] = [];
  const seenTeam = new Set<number>();
  for (const g of games) {
    for (const t of [g.away, g.home]) {
      if (wanted.has(t.id) && !seenTeam.has(t.id)) {
        seenTeam.add(t.id);
        entries.push({ team: t, gameId: g.id });
      }
    }
  }
  if (entries.length === 0) return null;

  return (
    <div className="fun-pennants" aria-label="Your teams this week">
      {entries.map(({ team, gameId }, i) => (
        <button
          key={team.id}
          onClick={() => onFocus(gameId)}
          title={`${team.school} — pin this game to Focus`}
          className="fun-pennant focus-visible:outline-2 focus-visible:outline-accent"
          style={
            {
              "--tc": team.color ?? "var(--push)",
              "--pr": `${(i % 2 === 0 ? 1 : -1) * (1.2 + (i % 3) * 0.8)}deg`,
            } as CSSProperties
          }
        >
          <span>{team.abbr}</span>
        </button>
      ))}
    </div>
  );
}

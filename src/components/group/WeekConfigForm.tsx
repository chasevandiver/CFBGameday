"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { setGroupWeekConfig } from "../../app/actions/groups";
import type { PickMarket, SelectionMode } from "../../lib/db-types";
import type { SeasonType } from "../../lib/season";
import { fmtSpread, type TeamView } from "../../lib/slate";
import { TeamLine } from "../slate/TeamLine";

export interface ConfigGame {
  id: number;
  /** For the checkbox's accessible name — the visible row is built from the
   *  team marks below, which carry no text an assistive tech would read. */
  label: string;
  away: TeamView;
  home: TeamView;
  kick: string;
  conferences: string[];
  /** Picks already made on this game, in this group. */
  pickCount: number;
  /** Consensus spread from the home side, and the total — the same numbers the
   *  slate shows. Owner request 2026-08-21: an admin building a board is
   *  choosing which games are worth picking, and "-1.5, 44" answers that in a
   *  glance where two logos and a kick time do not. Null before any book has
   *  posted, which is most of the week for a late-season game. */
  spread: number | null;
  total: number | null;
}

const MARKETS: Array<{ key: PickMarket; label: string; hint: string }> = [
  { key: "spread", label: "Spreads", hint: "against the number, snapshotted at pick time" },
  { key: "total", label: "Totals", hint: "over or under" },
  { key: "straight_up", label: "Winners", hint: "who wins, no number, no CLV" },
];

const MODES: Array<{ key: SelectionMode; label: string }> = [
  { key: "handpicked", label: "Handpick" },
  { key: "full_slate", label: "Full slate" },
  { key: "conference", label: "One conference" },
];

/**
 * The admin's format for one week.
 *
 * The count of picks a change would orphan is shown before saving, because the
 * cost of dropping a game is paid by whoever already picked it, and that is
 * invisible from the admin's side otherwise. Nothing is deleted either way —
 * orphaned picks stay on the board, greyed, out of the record.
 */
export function WeekConfigForm({
  groupId,
  seasonId,
  week,
  seasonType,
  games,
  conferences,
  locked,
  initial,
}: {
  groupId: string;
  seasonId: number;
  week: number;
  seasonType: SeasonType;
  games: ConfigGame[];
  conferences: string[];
  locked: boolean;
  initial: {
    mode: SelectionMode;
    conference: string | null;
    markets: PickMarket[];
    gameIds: number[];
    minPicks: number;
  } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [mode, setMode] = useState<SelectionMode>(initial?.mode ?? "handpicked");
  const [conference, setConference] = useState<string>(
    initial?.conference ?? conferences[0] ?? "",
  );
  /* Owner call, 2026-08-21: "default to everything unchecked." The games list
     already started empty; Spreads did not, and a pre-ticked market is the one
     box on this form that got saved without anyone deciding it. Save stays
     disabled until a market is chosen, which is the form asking rather than
     assuming. */
  const [markets, setMarkets] = useState<PickMarket[]>(initial?.markets ?? []);
  const [gameIds, setGameIds] = useState<number[]>(initial?.gameIds ?? []);
  const [minPicks, setMinPicks] = useState<number>(initial?.minPicks ?? 0);

  /** What the board would hold if this were saved now. */
  const selected = useMemo(() => {
    if (mode === "full_slate") return new Set(games.map((g) => g.id));
    if (mode === "conference")
      return new Set(games.filter((g) => g.conferences.includes(conference)).map((g) => g.id));
    return new Set(gameIds);
  }, [mode, conference, gameIds, games]);

  const orphaned = useMemo(() => {
    const droppedMarkets = (initial?.markets ?? []).filter((m) => !markets.includes(m));
    return games.reduce(
      (n, g) => n + (g.pickCount > 0 && !selected.has(g.id) ? g.pickCount : 0),
      droppedMarkets.length > 0 ? 0 : 0,
    );
  }, [games, selected, initial, markets]);
  const droppedMarkets = (initial?.markets ?? []).filter((m) => !markets.includes(m));

  if (locked) {
    return (
      <p className="text-sm text-dim">
        Week {week} is locked — the first game has kicked off. The format is fixed for the rest of
        the week so nothing can be re-scored after the fact.
      </p>
    );
  }

  const toggleMarket = (m: PickMarket) =>
    setMarkets((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const save = () =>
    start(async () => {
      setError(null);
      setSaved(false);
      const res = await setGroupWeekConfig({
        groupId,
        seasonId,
        week,
        seasonType,
        mode,
        conference: mode === "conference" ? conference : null,
        markets,
        gameIds,
        minPicks,
      });
      if (!res.ok) setError(res.message ?? "Could not save");
      else {
        setSaved(true);
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="mb-2 text-sm text-accent">Which games</legend>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              aria-pressed={mode === m.key}
              className={`stat min-h-11 rounded-lg border px-3.5 text-sm transition-colors ${
                mode === m.key
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-chalk/20 text-chalk hover:border-chalk/50"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "conference" && (
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-xs text-dim">Conference</span>
            <select
              value={conference}
              onChange={(e) => setConference(e.target.value)}
              className="min-h-11 rounded-lg border border-chalk/25 bg-elev px-3 text-sm text-chalk"
            >
              {conferences.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode !== "handpicked" && (
          <p className="mt-2 text-xs text-dim">
            {selected.size} of {games.length} games. This resolves live until the first kickoff, so
            a game added to the schedule joins the board on its own.
          </p>
        )}
      </fieldset>

      {mode === "handpicked" && (
        <fieldset>
          <legend className="mb-2 text-sm text-accent">
            Games <span className="text-dim">({gameIds.length} selected)</span>
          </legend>
          {/* Picking a board is a scouting job — which ranked teams, which
              records, which kickoff — so the list carries the same marks the
              board itself will. A column of "MIA at WMU" told the admin
              nothing they didn't already have to look up elsewhere. */}
          <ul className="scroll-thin max-h-96 overflow-y-auto rounded-lg border border-chalk/10">
            {games.map((g) => {
              const on = gameIds.includes(g.id);
              return (
                <li key={g.id} className="border-b border-chalk/5 last:border-0">
                  <label
                    className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 transition-colors ${
                      on ? "bg-accent/8" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      aria-label={g.label}
                      onChange={() =>
                        setGameIds((cur) =>
                          cur.includes(g.id) ? cur.filter((x) => x !== g.id) : [...cur, g.id],
                        )
                      }
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <TeamLine team={g.away} size={20} />
                      <TeamLine team={g.home} size={20} />
                    </span>
                    <span className="stat shrink-0 text-right text-[11px] leading-tight text-dim">
                      {g.kick}
                      {/* The line, so a board can be built around the games
                          worth picking. `tabular-nums` because these sit in a
                          scrolling column and a ragged one is harder to scan
                          than no column at all. */}
                      {(g.spread !== null || g.total !== null) && (
                        <span className="block tabular-nums text-chalk/70">
                          {g.spread !== null ? fmtSpread(g.spread) : "—"}
                          {g.total !== null ? ` · o${g.total}` : ""}
                        </span>
                      )}
                      {g.pickCount > 0 && (
                        <span className="block text-accent">{g.pickCount} picked</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-2 text-sm text-accent">Which bet types</legend>
        <ul className="flex flex-col gap-1">
          {MARKETS.map((m) => (
            <li key={m.key}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={markets.includes(m.key)}
                  onChange={() => toggleMarket(m.key)}
                />
                <span>
                  <span className="block text-sm text-chalk">{m.label}</span>
                  <span className="block text-[11px] text-dim">{m.hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {markets.length === 0 && (
          <p className="mt-1 text-xs text-loss">Turn on at least one bet type.</p>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm text-accent">Weekly minimum</legend>
        <label className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={50}
            value={minPicks}
            onChange={(e) => setMinPicks(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
            className="stat h-11 w-20 rounded-lg border border-chalk/25 bg-elev px-3 text-sm text-chalk"
          />
          <span className="text-[11px] leading-snug text-dim">
            {minPicks === 0
              ? "No minimum — pick as many or as few as you like."
              : `Members are expected to make ${minPicks} ${minPicks === 1 ? "pick" : "picks"} this week.`}{" "}
            Shown on the board, not enforced: nobody gets blocked from picking, and nobody&rsquo;s
            week gets voided.
          </span>
        </label>
      </fieldset>

      {(orphaned > 0 || droppedMarkets.length > 0) && (
        <p className="rounded-lg border border-edge/40 bg-edge/10 px-3 py-2 text-xs text-chalk">
          {orphaned > 0 && (
            <>
              {orphaned} {orphaned === 1 ? "pick is" : "picks are"} on games you&rsquo;re dropping.{" "}
            </>
          )}
          {droppedMarkets.length > 0 && <>You&rsquo;re turning a bet type off. </>}
          Nothing gets deleted — those picks stay on the board, greyed, and stop counting.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending || markets.length === 0 || (mode === "handpicked" && gameIds.length === 0)}
          className="stat min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save week"}
        </button>
        {saved && <span className="stat text-xs text-win">Saved</span>}
        {error && <span className="text-xs text-loss">{error}</span>}
      </div>
    </div>
  );
}

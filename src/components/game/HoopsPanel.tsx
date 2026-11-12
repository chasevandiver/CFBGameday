"use client";

/**
 * The basketball game page's box (CBB-10) — what `BoxScore`, `GameFlow` and
 * `ScoringTimeline` are for football, as one section.
 *
 * A football game is read by quarter and by scoring play. A basketball game
 * has a hundred scoring plays and nobody reads them; it is read by half, by
 * how each team is shooting, by who has the points, and — live — by who is
 * in the bonus. So:
 *
 *   1. the line score by half (plus overtimes), with the pace beside the total
 *   2. team fouls this half and what each team is shooting because of them
 *   3. the team comparison: FG, 3PT, FT, rebounds, assists, turnovers
 *   4. each team's scorers
 *
 * Data comes from `/api/hoops/[id]` (see that route for why this one section
 * fetches on demand rather than reading Postgres), refreshed every 20 seconds
 * while the game is live and the tab is visible, once when it is final.
 *
 * Every number is tabular and every table has fixed columns, so a refresh
 * changes digits and moves nothing (DESIGN.md).
 */

import { useEffect, useState } from "react";
import {
  bonusFor,
  cbbPace,
  cbbPeriodLabel,
  hoopsRead,
  type BonusState,
} from "../../lib/cbb";
import type { HoopsBox, HoopsPlayerLine, HoopsTeamBox } from "../../lib/espn-cbb";
import { fmtSpread, fmtTotal, lineForSide, type TeamView } from "../../lib/slate";

interface Props {
  gameId: number;
  status: string;
  home: TeamView;
  away: TeamView;
  homePoints: number | null;
  awayPoints: number | null;
  /** The market, home-perspective. Null where there is no line. */
  lines: { spread: number | null; total: number | null };
}

const TH = "stat px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-chalk/50";
// nowrap: "4-10" must not break at its hyphen into a two-line cell.
const TD = "stat whitespace-nowrap px-2 py-1.5 text-right text-sm tabular-nums text-chalk";

/** Said with the team's name: a bare "Bonus" beside a foul count reads as
 *  belonging to the team that fouled, which is the opposite of the fact. */
function bonusText(b: BonusState, abbr: string): string {
  return b === "double" ? `${abbr} in double bonus` : b === "bonus" ? `${abbr} in bonus` : "";
}

export function HoopsPanel({ gameId, status, home, away, homePoints, awayPoints, lines }: Props) {
  const [box, setBox] = useState<HoopsBox | null>(null);
  const [loaded, setLoaded] = useState(false);
  const live = status === "in_progress";
  const started = live || status === "final";

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    const load = () =>
      fetch(`/api/hoops/${gameId}`, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok || cancelled) return;
          const body = (await res.json()) as { box: HoopsBox | null };
          // A failed refresh must not blank a box that is already on screen.
          if (body.box) setBox(body.box);
        })
        .catch(() => {
          /* transient — the next tick retries */
        })
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });
    void load();
    if (!live) return () => void (cancelled = true);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gameId, live, started]);

  if (!started) return null;
  if (!box) {
    // Reserve the section's place while the first fetch is out, so the market
    // table below does not jump down when the box arrives.
    return (
      <section className="card mt-4 px-4 py-4" aria-busy={!loaded}>
        <h2 className="text-sm text-accent">Box score</h2>
        <p className="mt-3 text-sm text-dim">
          {loaded ? "The box score is not available for this game yet." : "Loading the box score…"}
        </p>
      </section>
    );
  }

  const periods = Math.max(2, box.home.line.length, box.away.line.length);
  const cols = Array.from({ length: periods }, (_, i) => i + 1);
  const hTotal = homePoints ?? box.home.line.reduce((a, b) => a + b, 0);
  const aTotal = awayPoints ?? box.away.line.reduce((a, b) => a + b, 0);
  const read = hoopsRead({
    homePoints: hTotal,
    awayPoints: aTotal,
    period: box.period,
    clock: box.clock,
    lines,
  });
  const pace = live ? cbbPace(hTotal, aTotal, box.period, box.clock) : null;
  const halfIdx = box.half - 1;
  // A team shoots the bonus on its OPPONENT's fouls.
  const homeBonus = bonusFor(box.away.foulsByHalf[halfIdx]);
  const awayBonus = bonusFor(box.home.foulsByHalf[halfIdx]);
  const coverTeam =
    read.cover && read.cover.side !== "push" ? (read.cover.side === "home" ? home : away) : null;

  return (
    <>
      <section className="card mt-4 overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-chalk/8 px-4 py-2.5">
          <h2 className="shrink-0 whitespace-nowrap text-sm text-accent">Box score</h2>
          {(read.cover || read.total !== null) && (
            <span className="stat whitespace-nowrap text-[11px] text-dim">
              {read.cover &&
                (coverTeam ? (
                  <>
                    <span className="text-chalk">
                      {coverTeam.abbr} {fmtSpread(lineForSide(read.cover.side, lines.spread))}
                    </span>{" "}
                    {live ? "covering" : "covered"} by {read.cover.by}
                  </>
                ) : (
                  "On the number"
                ))}
              {read.cover && read.total !== null && " · "}
              {read.total !== null &&
                (pace !== null ? (
                  <>
                    pace <span className="text-chalk">{pace}</span> / {fmtTotal(read.total)}
                  </>
                ) : (
                  <>
                    total <span className="text-chalk">{hTotal + aTotal}</span> / {fmtTotal(read.total)}
                  </>
                ))}
            </span>
          )}
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[280px]">
            <thead>
              <tr>
                <th className="stat px-4 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-chalk/50">
                  Team
                </th>
                {cols.map((n) => (
                  <th key={n} className={TH}>
                    {cbbPeriodLabel(n)}
                  </th>
                ))}
                <th className={`${TH} pr-4`}>T</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  [away, box.away, aTotal],
                  [home, box.home, hTotal],
                ] as Array<[TeamView, HoopsTeamBox, number]>
              ).map(([team, t, total]) => (
                <tr key={team.id} className="border-t border-chalk/8">
                  <td className="px-4 py-1.5 text-sm font-semibold text-chalk">{team.abbr}</td>
                  {cols.map((n) => (
                    <td key={n} className={TD}>
                      {t.line[n - 1] ?? "–"}
                    </td>
                  ))}
                  <td className={`${TD} pr-4 font-semibold`}>{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Fouls this half and what they have earned. Live only: on a final
            the bonus is history and the totals are in the comparison below. */}
        {live && (
          <div className="grid grid-cols-2 border-t border-chalk/8">
            {(
              [
                [away, box.away, awayBonus],
                [home, box.home, homeBonus],
              ] as Array<[TeamView, HoopsTeamBox, BonusState]>
            ).map(([team, t, bonus], i) => (
              <div key={team.id} className={`px-4 py-2.5 ${i === 0 ? "border-r border-chalk/8" : ""}`}>
                <p className="stat text-[10px] font-semibold uppercase tracking-wider text-chalk/50">
                  {team.abbr} fouls · {box.half === 1 ? "1st half" : "2nd half"}
                </p>
                <p className="stat mt-0.5 flex min-h-5 items-baseline gap-2 text-sm text-chalk">
                  <span className="text-lg font-semibold tabular-nums">{t.foulsByHalf[halfIdx]}</span>
                  {bonus && <span className="chip bg-chalk/10 text-chalk">{bonusText(bonus, team.abbr)}</span>}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card mt-4 overflow-hidden">
        <h2 className="border-b border-chalk/8 px-4 py-2.5 text-sm text-accent">Team stats</h2>
        {/* Column heads, above the numbers they name. */}
        <div className="flex justify-between border-b border-chalk/8 px-4 py-1.5 text-[11px] font-semibold text-dim">
          <span>{away.abbr}</span>
          <span>{home.abbr}</span>
        </div>
        <div className="px-4 py-1">
          <StatRow label="Field goals" away={shot(box.away.fg, box.away.fgPct)} home={shot(box.home.fg, box.home.fgPct)} />
          <StatRow label="Three-pointers" away={shot(box.away.three, box.away.threePct)} home={shot(box.home.three, box.home.threePct)} />
          <StatRow label="Free throws" away={shot(box.away.ft, box.away.ftPct)} home={shot(box.home.ft, box.home.ftPct)} />
          <StatRow label="Rebounds" away={withSub(box.away.rebounds, box.away.offRebounds, "off")} home={withSub(box.home.rebounds, box.home.offRebounds, "off")} />
          <StatRow label="Assists" away={n(box.away.assists)} home={n(box.home.assists)} />
          <StatRow label="Turnovers" away={n(box.away.turnovers)} home={n(box.home.turnovers)} />
          <StatRow label="Fouls" away={n(box.away.fouls)} home={n(box.home.fouls)} />
          <StatRow label="Points in the paint" away={n(box.away.paintPoints)} home={n(box.home.paintPoints)} />
          <StatRow label="Largest lead" away={n(box.away.largestLead)} home={n(box.home.largestLead)} last />
        </div>
        {box.leadChanges !== null && (
          <p className="stat border-t border-chalk/8 px-4 py-2 text-center text-[11px] text-dim">
            {box.leadChanges} lead {box.leadChanges === 1 ? "change" : "changes"}
          </p>
        )}
      </section>

      <Scorers team={away} players={box.away.players} />
      <Scorers team={home} players={box.home.players} />
    </>
  );
}

const n = (v: number | null): string => (v === null ? "–" : String(v));
const shot = (made: string | null, pct: number | null): string =>
  made === null ? "–" : pct === null ? made : `${made} · ${pct}%`;
const withSub = (v: number | null, sub: number | null, word: string): string =>
  v === null ? "–" : sub === null ? String(v) : `${v} · ${sub} ${word}`;

function StatRow({
  label,
  away,
  home,
  last = false,
}: {
  label: string;
  away: string;
  home: string;
  last?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 py-1.5 ${
        last ? "" : "border-b border-chalk/8"
      }`}
    >
      <span className="stat text-sm tabular-nums text-chalk">{away}</span>
      <span className="text-center text-[11px] text-dim">{label}</span>
      <span className="stat text-right text-sm tabular-nums text-chalk">{home}</span>
    </div>
  );
}

/** Everyone who scored, scorers first; the rest of the bench is noise here. */
function Scorers({ team, players }: { team: TeamView; players: HoopsPlayerLine[] }) {
  const shown = players.filter((p) => p.pts > 0 || p.min >= 10).slice(0, 9);
  if (shown.length === 0) return null;
  return (
    <section className="card mt-4 overflow-hidden">
      <h2 className="border-b border-chalk/8 px-4 py-2.5 text-sm text-accent">{team.school}</h2>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[340px]">
          <thead>
            <tr>
              <th className="stat px-4 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-chalk/50">
                Player
              </th>
              {["Min", "Pts", "Reb", "Ast", "FG", "3PT", "PF"].map((h) => (
                <th key={h} className={`${TH} ${h === "PF" ? "pr-4" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={`${p.jersey}-${p.name}`} className="border-t border-chalk/8">
                <td className="max-w-[7rem] truncate px-4 py-1.5 text-sm text-chalk">{p.name}</td>
                <td className={`${TD} text-dim`}>{p.min}</td>
                <td className={`${TD} font-semibold`}>{p.pts}</td>
                <td className={TD}>{p.reb}</td>
                <td className={TD}>{p.ast}</td>
                <td className={TD}>{p.fg}</td>
                <td className={TD}>{p.three}</td>
                {/* Four fouls is the number a basketball fan scans for. */}
                <td className={`${TD} pr-4 ${p.pf >= 4 ? "font-semibold" : "text-dim"}`}>{p.pf}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

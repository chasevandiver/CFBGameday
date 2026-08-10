import { Flame, Snowflake, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import type { SheetMember } from "../../lib/betting-groups";
import { DEFAULT_TZ, kickParts, tzLabel } from "../../lib/kick";
import { formatRecord, type Tally } from "../../lib/records";
import { betSideLabel, type GameView } from "../../lib/slate";
import type { PairStats } from "../../lib/tailing";
import { TeamLine } from "../slate/TeamLine";

/**
 * A betting group's furniture.
 *
 * The pick'em hub asks "have you got your picks in". A betting group has
 * nothing to get in — everyone is already betting — so its hub asks the two
 * questions a group of bettors actually argues about: who is running good, and
 * is anybody here worth copying. Both are answered from the same classified
 * sheet (`lib/tailing.ts`); nothing on this page is stored.
 */

/** Units, signed and coloured. The only number this product really keeps. */
export function Units({ t, className = "" }: { t: Tally; className?: string }) {
  if (t.decided === 0) return <span className={`stat text-chalk/35 ${className}`}>—</span>;
  return (
    <span
      className={`stat ${t.units > 0 ? "text-win" : t.units < 0 ? "text-loss" : "text-chalk/60"} ${className}`}
    >
      {t.units >= 0 ? "+" : ""}
      {t.units.toFixed(1)}u
    </span>
  );
}

/** "12-8 · +4.2u", or a dash before anything grades. */
export function RecordAndUnits({ t }: { t: Tally }) {
  if (t.decided === 0) return <span className="stat text-chalk/35">—</span>;
  return (
    <span className="stat whitespace-nowrap">
      <span className="text-chalk">{formatRecord(t)}</span>{" "}
      <Units t={t} className="text-[11px]" />
    </span>
  );
}

export function FormPip({ label }: { label: "hot" | "cold" | "level" }) {
  if (label === "level") return null;
  const hot = label === "hot";
  return (
    <span
      className={`chip ${hot ? "bg-edge/15 text-edge" : "bg-push/15 text-push"}`}
      title={
        hot
          ? "Won at least 3 more than they lost over their last 10 graded bets"
          : "Lost at least 3 more than they won over their last 10 graded bets"
      }
    >
      {hot ? <Flame size={10} aria-hidden /> : <Snowflake size={10} aria-hidden />}
      {hot ? "Hot" : "Cold"}
    </span>
  );
}

/**
 * One member of the sheet.
 *
 * Their own record leads, because that is what they'd tell you. The two
 * numbers underneath are the ones they wouldn't: how their opens have done,
 * and how everyone who copied them has done. Those diverge more often than
 * anybody expects — a good bettor who posts late is a bad source, and the only
 * way to see it is to keep the two apart.
 */
export function SourceCard({
  place,
  member,
  isMe,
}: {
  place: number;
  member: SheetMember;
  isMe: boolean;
}) {
  const s = member.stats;
  return (
    <li className={`card px-3.5 py-2.5 ${isMe ? "ring-1 ring-inset ring-accent/40" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="stat w-5 shrink-0 text-center text-sm text-chalk/35">{place}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium text-chalk">{member.name}</span>
            {isMe && (
              <span className="stat shrink-0 text-[10px] uppercase tracking-wider text-accent">
                you
              </span>
            )}
            <FormPip label={member.form.label} />
          </span>
          <span className="stat block text-[10.5px] leading-tight text-chalk/45">
            {s.overall.decided === 0
              ? "nothing graded yet"
              : `${s.overall.decided} graded · ${
                  s.overall.roi === null ? "no priced action" : `${(s.overall.roi * 100).toFixed(0)}% ROI`
                }${
                  s.overall.avgClv === null
                    ? ""
                    : ` · CLV ${s.overall.avgClv > 0 ? "+" : ""}${s.overall.avgClv.toFixed(2)}`
                }`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="stat block text-lg font-semibold leading-none text-chalk">
            {s.overall.decided > 0 ? formatRecord(s.overall) : "—"}
          </span>
          <Units t={s.overall} className="block text-[11px] leading-tight" />
        </span>
      </div>

      {/* What they're worth to everyone else. Only rendered once somebody has
          actually followed them — before that it is four dashes and a question. */}
      {s.timesFollowed > 0 && (
        <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-chalk/8 pt-2 text-[10.5px]">
          <Mini label="They open" t={s.originated} hint="Bets where they were first in the group" />
          <Mini
            label="Tailing them"
            t={s.tailedByOthers}
            hint="How everyone who rode them has done"
          />
          <Mini
            label="Fading them"
            t={s.fadedByOthers}
            hint="How everyone who took the other side has done"
          />
        </dl>
      )}
    </li>
  );
}

function Mini({ label, t, hint }: { label: string; t: Tally; hint: string }) {
  return (
    <div title={hint}>
      <dt className="stat text-[9.5px] uppercase tracking-wider text-chalk/35">{label}</dt>
      <dd className="stat mt-0.5 text-chalk/80">
        {t.decided === 0 ? <span className="text-chalk/30">—</span> : formatRecord(t)}
        {t.decided > 0 && (
          <>
            {" "}
            <Units t={t} className="text-[10px]" />
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * The viewer against everybody else: riding them versus opposing them.
 *
 * This is the sheet's whole reason for existing and it cannot be read off
 * anyone's own record — a source's season counts the bets you never saw in
 * time. Both columns render even when one is empty, because "I've never faded
 * Mo" is itself the answer to how fading Mo goes.
 */
export function PairPanel({
  pairs,
  nameById,
}: {
  pairs: PairStats[];
  nameById: Map<string, string>;
}) {
  if (pairs.length === 0) return null;
  return (
    <section className="card overflow-x-auto">
      <table className="stats w-full text-sm">
        <thead>
          <tr className="border-b border-chalk/10 text-left text-[10.5px] uppercase tracking-wider text-chalk/55">
            <th className="py-2 pl-4 pr-2 font-semibold">Behind</th>
            <th className="px-2 py-2 text-right font-semibold">
              <TrendingUp size={11} aria-hidden className="mr-1 inline" />
              Tailing
            </th>
            <th className="py-2 pl-2 pr-4 text-right font-semibold">
              <TrendingDown size={11} aria-hidden className="mr-1 inline" />
              Fading
            </th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr key={p.otherId} className="border-b border-chalk/5 last:border-0">
              <td className="py-2 pl-4 pr-2 font-sans text-chalk">
                {nameById.get(p.otherId) ?? "A member"}
              </td>
              <td className="px-2 py-2 text-right">
                <RecordAndUnits t={p.tailing} />
              </td>
              <td className="py-2 pl-2 pr-4 text-right">
                <RecordAndUnits t={p.fading} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * One game on the week's sheet: the matchup, then who is on it.
 *
 * The slate's card carries the same information with a tail button attached;
 * this is the list view of it, for reading the whole Saturday at once rather
 * than deciding one game.
 */
export function SheetGameRow({ game }: { game: GameView }) {
  const kick = game.startTs === null ? null : kickParts(game.startTs, DEFAULT_TZ);
  return (
    <li className="card overflow-hidden">
      <Link href={`/game/${game.id}`} className="flex items-start gap-2 px-3 py-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <TeamLine team={game.away} size={20} showRecord={false} />
          <TeamLine team={game.home} size={20} showRecord={false} />
        </span>
        <span className="stat shrink-0 text-right text-[10.5px] leading-tight text-dim">
          {game.status === "final"
            ? `Final ${game.awayPoints}–${game.homePoints}`
            : game.status === "in_progress"
              ? `${game.awayPoints}–${game.homePoints} live`
              : kick
                ? `${kick.day} ${kick.time} ${tzLabel(DEFAULT_TZ)}`
                : "TBD"}
        </span>
      </Link>
      <ul className="border-t border-chalk/8 px-3 py-1.5">
        {game.groupBets.map((b) => (
          <li key={b.betId} className="flex items-center gap-1.5 py-0.5 text-[11px]">
            <span className={`truncate ${b.isViewer ? "text-accent" : "text-chalk/85"}`}>
              {b.isViewer ? "You" : b.name}
            </span>
            {/* Through the shared formatter, never raw: line_taken is stored
                home-perspective and printing it as-is inverts every away
                ticket's sign. */}
            <span className="stat shrink-0 text-chalk">
              {betSideLabel(b.betType, b.side, b.line, game.home.abbr, game.away.abbr)}
            </span>
            <span className="stat shrink-0 text-[10px] text-chalk/35">{b.units}u</span>
            <span className="stat ml-auto shrink-0 text-[10px] uppercase tracking-wider text-chalk/40">
              {b.relation === "origin"
                ? "first"
                : `${b.relation === "tail" ? "tail" : "fade"} ${b.sourceName?.split(" ")[0] ?? ""}`}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

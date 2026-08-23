import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../../../components/AppNav";
import { SeasonNumbers } from "../../../../../components/SeasonNumbers";
import { FormPip, RecordAndUnits, Units } from "../../../../../components/group/BettingHub";
import { ResultChip } from "../../../../../components/slate/chips";
import { fetchBettingSheet } from "../../../../../lib/betting-groups";
import { resolveActiveGroup } from "../../../../../lib/groups";
import { fetchCurrentSeasonWeek } from "../../../../../lib/queries";
import { formatRecord, type Tally } from "../../../../../lib/records";
import { betSideLabel } from "../../../../../lib/slate";
import { createClient } from "../../../../../lib/supabase/server";
import { pairStatsFor, type ClassifiedBet } from "../../../../../lib/tailing";
import {
  extremes,
  lateFlips,
  marketSplit,
  streaks,
  type FlipRow,
} from "../../../../../lib/bet-stats";
import { DEFAULT_TZ } from "../../../../../lib/kick";

export const dynamic = "force-dynamic";

/**
 * One member of a betting group, in full (GRP-8).
 *
 * The GRP-7 expando answers the quick question — what is this person worth to
 * ME — in two numbers. Owner, same day: *"I want to be able to click on their
 * name and see other users full stats and bet history. Not just tail/fade."*
 * A season of bets is a list, and a list belongs on a page, not in an
 * accordion.
 *
 * Everything here is the group's own already-loaded book: `fetchBettingSheet`
 * reads every member's bets for the season (both leagues, 0042), and RLS has
 * always allowed exactly this — the sheet renders the same rows on the group
 * home. This page adds no reach a member did not already have; it gives the
 * reach a URL.
 */
export default async function GroupMemberPage({
  params,
}: {
  params: Promise<{ slug: string; memberId: string }>;
}) {
  const { slug, memberId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { active } = await resolveActiveGroup(supabase, user?.id ?? null, slug);
  // Same posture as the group home: RLS hides a private group from a
  // non-member, so "not found" and "not yours" are deliberately one answer.
  if (!active || active.slug !== slug || active.kind !== "betting") notFound();

  const { seasonId } = await fetchCurrentSeasonWeek(supabase);
  const sheet = await fetchBettingSheet(supabase, active.id, seasonId);
  const member = sheet.members.find((m) => m.userId === memberId);
  // A uuid that is not in this group is a page that does not exist — the same
  // non-answer a wrong slug gets, for the same reason.
  if (!member) notFound();

  const s = member.stats;
  const isMe = user?.id === memberId;
  const pair =
    !isMe && user ? (pairStatsFor(sheet.bets, user.id).find((p) => p.otherId === memberId) ?? null) : null;

  /* Their season, newest first. The classified rows carry relation and
     result; the games read fills in who they bet on. */
  const history = sheet.bets
    .filter((b) => b.userId === memberId)
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt) || b.id - a.id);
  const gameIds = [...new Set(history.map((b) => b.gameId).filter((id): id is number => id !== null))];
  const { data: gameRows } =
    gameIds.length > 0
      ? await supabase
          .from("games")
          .select("id, season_id, start_ts, home_team_id, away_team_id")
          .in("id", gameIds)
      : { data: [] };
  type GameRow = {
    id: number;
    season_id: number;
    start_ts: string | null;
    home_team_id: number;
    away_team_id: number;
  };
  const games = new Map(((gameRows ?? []) as GameRow[]).map((g) => [g.id, g]));
  const teamIds = [
    ...new Set([...games.values()].flatMap((g) => [g.home_team_id, g.away_team_id])),
  ];
  const { data: teamRows } =
    teamIds.length > 0
      ? await supabase.from("teams").select("id, school, abbreviation").in("id", teamIds)
      : { data: [] };
  const teams = new Map(
    ((teamRows ?? []) as Array<{ id: number; school: string; abbreviation: string | null }>).map(
      (t) => [t.id, t.abbreviation ?? t.school.slice(0, 4).toUpperCase()],
    ),
  );

  /* GRP-9: the deeper cuts. cover_flips has recorded every late ATS/O-U swing
     since 0026 precisely so "how many bad beats has this person taken" is a
     join, not a memory. One read scoped to their games; the rest is pure. */
  const { data: flipRows } =
    gameIds.length > 0
      ? await supabase
          .from("cover_flips")
          .select("game_id, market, from_side, to_side, period")
          .in("game_id", gameIds)
      : { data: [] };
  const beats = lateFlips(history, (flipRows ?? []) as FlipRow[]);
  const markets = marketSplit(history);
  const run = streaks(history);
  const ends = extremes(history);
  /* Who THEY follow — pairStatsFor run for the member being viewed, the same
     function GRP-7 runs for the viewer. "Hayden tails Chase 3-1 and fades Dave
     0-2" is the sheet's whole social claim, per person, with receipts. */
  const theirPairs = pairStatsFor(sheet.bets, memberId);

  const kickDay = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TZ,
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Link
          href={`/groups/${active.slug}`}
          className="stat inline-flex min-h-11 items-center gap-1.5 text-xs text-dim hover:text-chalk"
        >
          <ArrowLeft size={13} aria-hidden />
          {active.name}
        </Link>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="flex items-center gap-2 text-2xl">
            {member.name}
            {isMe && (
              <span className="stat text-[10px] uppercase tracking-wider text-accent">you</span>
            )}
            <FormPip label={member.form.label} />
          </h1>
          <RecordAndUnits t={s.overall} />
        </div>
        <p className="stat mt-1 text-xs text-chalk/50">
          {s.overall.decided === 0
            ? "Nothing graded yet."
            : `${s.overall.decided} graded · ${
                s.overall.roi === null ? "no priced action" : `${(s.overall.roi * 100).toFixed(0)}% ROI`
              }${s.overall.avgClv === null ? "" : ` · CLV ${s.overall.avgClv > 0 ? "+" : ""}${s.overall.avgClv.toFixed(2)}`}`}
        </p>

        {/* The full stat grid: their book from every angle this group keeps.
            League split first (the two records that make one season), then the
            group-relational trio, then — on someone else's page — YOUR history
            with them, which is the number GRP-7 taught the tap for. */}
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="CFB" t={member.leagueSplit.cfb} />
          <Stat label="NFL" t={member.leagueSplit.nfl} />
          <Stat label="They open" t={s.originated} hint="Bets where they were first in the group" />
          <Stat
            label="Others tailing them"
            t={s.tailedByOthers}
            hint="How everyone who rode their bets has done"
          />
          <Stat
            label="Others fading them"
            t={s.fadedByOthers}
            hint="How everyone who took the other side of their bets has done"
          />
          {pair && (
            <>
              <Stat label="You tailing them" t={pair.tailing} accent />
              <Stat label="You fading them" t={pair.fading} accent />
            </>
          )}
        </dl>

        {/* ---- the deeper cuts (GRP-9) ---- */}
        {markets.length > 0 && (
          <section className="mt-6" aria-labelledby="markets-heading">
            <SectionRule id="markets-heading" title="By market" />
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {markets.map((m) => (
                <Stat key={m.key} label={m.label} t={m.t} />
              ))}
            </dl>
          </section>
        )}

        {history.some((b) => b.result === "win" || b.result === "loss") && (
          <SeasonNumbers id="story-heading" flips={beats} run={run} ends={ends} />
        )}

        {theirPairs.length > 0 && (
          <section className="mt-6" aria-labelledby="follows-heading">
            <SectionRule
              id="follows-heading"
              title="Who they follow"
              count={`${theirPairs.length} in the group`}
            />
            {/* Owner report 2026-08-23: the bare "tailing — / fading 0-1" row
                read as noise — whose record, in which direction? The rows are
                sentences now, subject first, and an empty half simply is not
                said: dashes were most of the confusion. */}
            <p className="stat -mt-1 mb-2 text-[11px] text-chalk/50">
              {member.name}&rsquo;s record when they bet behind — or against — each group-mate.
            </p>
            {/* Broken down BY PERSON — the record they post when copying (or
                opposing) each specific member, with receipts. This is
                pairStatsFor run for the member on the page, exactly the
                function GRP-7 runs for the viewer. */}
            <ul className="flex flex-col gap-1.5">
              {theirPairs.map((p) => (
                <li key={p.otherId} className="card flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-chalk">
                    {sheet.nameById.get(p.otherId) ?? "A member"}
                  </span>
                  {p.tailing.decided > 0 && <PairCell label="tails them" t={p.tailing} />}
                  {p.fading.decided > 0 && <PairCell label="fades them" t={p.fading} />}
                  {p.tailing.decided === 0 && p.fading.decided === 0 && (
                    <span className="stat shrink-0 text-[11px] text-chalk/35">
                      followed, nothing graded yet
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6" aria-labelledby="history-heading">
          <SectionRule id="history-heading" title="Bet history" count={`${history.length} this season`} />
          {history.length === 0 ? (
            <p className="card px-3.5 py-3 text-sm text-chalk/60">
              No bets logged this season.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {history.map((b) => (
                <HistoryRow key={b.id} bet={b} games={games} teams={teams} fmt={kickDay} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function SectionRule({ id, title, count }: { id: string; title: string; count?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2">
      <h2 id={id} className="text-sm text-accent">
        {title}
      </h2>
      {count && <span className="stat text-[11px] text-dim">{count}</span>}
      <span className="h-px flex-1 bg-chalk/10" aria-hidden />
    </div>
  );
}

/** "tailing 3-1 +2.1u" — one half of a who-they-follow row. */
function PairCell({ label, t }: { label: string; t: Tally }) {
  return (
    <span className="stat shrink-0 text-[11px]">
      <span className="text-dim">{label} </span>
      {t.decided === 0 ? (
        <span className="text-chalk/35">—</span>
      ) : (
        <>
          <span className="text-chalk">{formatRecord(t)}</span>{" "}
          <Units t={t} className="text-[10.5px]" />
        </>
      )}
    </span>
  );
}

function Stat({
  label,
  t,
  hint,
  accent = false,
}: {
  label: string;
  t: Tally;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`card px-3 py-2 ${accent ? "ring-1 ring-inset ring-accent/40" : ""}`}
      title={hint}
    >
      <dt className="stat text-[10.5px] uppercase tracking-wide text-dim">{label}</dt>
      <dd className="mt-0.5">
        {t.decided === 0 ? (
          <span className="stat text-chalk/35">—</span>
        ) : (
          <span className="stat text-sm">
            <span className="text-chalk">{formatRecord(t)}</span>{" "}
            <Units t={t} className="text-[11px]" />
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * One bet: when, what, against whom in the group, and how it ended. The result
 * chip keeps the grader's vocabulary — Won / Lost / Push / Void — and an
 * ungraded row simply carries no chip, which on a history list reads as "still
 * open" without a fifth word.
 */
function HistoryRow({
  bet,
  games,
  teams,
  fmt,
}: {
  bet: ClassifiedBet;
  games: Map<number, { start_ts: string | null; home_team_id: number; away_team_id: number }>;
  teams: Map<number, string>;
  fmt: Intl.DateTimeFormat;
}) {
  const g = bet.gameId !== null ? games.get(bet.gameId) : undefined;
  const home = g ? (teams.get(g.home_team_id) ?? "?") : null;
  const away = g ? (teams.get(g.away_team_id) ?? "?") : null;
  const label = home && away ? betSideLabel(bet.betType, bet.side, bet.line, home, away) : bet.betType;
  return (
    <li className="card flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className="stat w-14 shrink-0 text-[11px] text-dim">
        {g?.start_ts ? fmt.format(new Date(g.start_ts)) : "—"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="stat block text-sm text-chalk">{label}</span>
        <span className="stat block text-[10.5px] text-chalk/45">
          {away && home ? `${away} @ ${home}` : "no game attached"}
          {bet.relation === "tail" && " · tailed"}
          {bet.relation === "fade" && " · faded"}
          {bet.relation === "origin" && bet.tailedBy + bet.fadedBy > 0
            ? ` · ${bet.tailedBy} tailed, ${bet.fadedBy} faded`
            : ""}
        </span>
      </span>
      <span className="stat shrink-0 text-[11px] text-chalk/60">{bet.units.toFixed(1)}u</span>
      {bet.result && (
        <ResultChip
          label={bet.result === "win" ? "Won" : bet.result === "loss" ? "Lost" : bet.result === "void" ? "Void" : "Push"}
          result={bet.result === "win" ? "pass" : bet.result === "loss" ? "fail" : "push"}
        />
      )}
    </li>
  );
}

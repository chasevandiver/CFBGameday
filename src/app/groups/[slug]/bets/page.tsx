import { ArrowLeft, ChevronLeft, ChevronRight, PenLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../../components/AppNav";
import { VoidBetButton } from "../../../../components/VoidBetButton";
import { memberHref, RecordAndUnits } from "../../../../components/group/BettingHub";
import { CopyBetButtons } from "../../../../components/group/CopyBetButtons";
import { ResultChip } from "../../../../components/slate/chips";
import { fetchBettingSheet } from "../../../../lib/betting-groups";
import { resolveActiveGroup } from "../../../../lib/groups";
import { DEFAULT_TZ } from "../../../../lib/kick";
import { sportOfSeasonId } from "../../../../lib/league";
import { fetchCurrentSeasonWeek } from "../../../../lib/queries";
import { tally } from "../../../../lib/records";
import { betSideLabel, fmtMoneyline } from "../../../../lib/slate";
import { createClient } from "../../../../lib/supabase/server";
import type { ClassifiedBet } from "../../../../lib/tailing";
import { chooseWeek, copyTargets, neighbourWeeks } from "../../../../lib/week-bets";
import { footballWeekKey, rangeLabel } from "../../../../lib/week-records";

export const dynamic = "force-dynamic";

export const metadata = { title: "Who bet what" };

type GameRow = {
  id: number;
  season_id: number;
  start_ts: string | null;
  status: string;
  home_team_id: number;
  away_team_id: number;
  home_points: number | null;
  away_points: number | null;
};

/**
 * A betting group's week, one person at a time (LOGF-7).
 *
 * Everything every member has on a game that kicked off in this Tuesday-to-
 * Monday week, both leagues, newest week by default. A member with nothing
 * logged gets an empty section that says so — the absence is the point: it is
 * how the admin who types in everyone's texted bets finds the one that never
 * made it. Under each bet, the admin gets a "+ name" per member who does not
 * already hold it (a tail that was texted but not typed), a void for a row
 * typed wrong, and every member gets "+ Me" to tail it themselves.
 *
 * Read from the same `fetchBettingSheet` the group home renders, so the
 * tail/fade attribution here is the sheet's own and cannot disagree with it.
 */
export default async function GroupBetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ wk?: string }>;
}) {
  const { slug } = await params;
  const { wk } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  const { active } = await resolveActiveGroup(supabase, viewerId, slug);
  if (!active || active.slug !== slug || active.kind !== "betting") notFound();

  const { seasonId } = await fetchCurrentSeasonWeek(supabase);
  const sheet = await fetchBettingSheet(supabase, active.id, seasonId);
  const rawById = new Map(sheet.raw.map((b) => [b.id, b]));
  // League Rule #4: a void never happened. The ledger still has it.
  const live = sheet.bets.filter((b) => b.voidedAt === null);

  const gameIds = [...new Set(live.map((b) => b.gameId).filter((id): id is number => id !== null))];
  const { data: gameRows } =
    gameIds.length > 0
      ? await supabase
          .from("games")
          .select("id, season_id, start_ts, status, home_team_id, away_team_id, home_points, away_points")
          .in("id", gameIds)
      : { data: [] };
  const games = new Map(((gameRows ?? []) as GameRow[]).map((g) => [g.id, g]));
  const teamIds = [...new Set([...games.values()].flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: teamRows } =
    teamIds.length > 0
      ? await supabase.from("teams").select("id, school, abbreviation").in("id", teamIds)
      : { data: [] };
  const abbr = new Map(
    ((teamRows ?? []) as Array<{ id: number; school: string; abbreviation: string | null }>).map(
      (t) => [t.id, t.abbreviation ?? t.school.slice(0, 4).toUpperCase()],
    ),
  );

  const weekOf = (b: ClassifiedBet): string | null => {
    const g = b.gameId === null ? undefined : games.get(b.gameId);
    return g?.start_ts ? footballWeekKey(g.start_ts, DEFAULT_TZ) : null;
  };
  const keysWithBets = [
    ...new Set(live.map(weekOf).filter((k): k is string => k !== null)),
  ];
  const currentKey = footballWeekKey(new Date().toISOString(), DEFAULT_TZ);
  const key = chooseWeek(keysWithBets, currentKey, wk);
  const { prev, next } = neighbourWeeks(keysWithBets, currentKey, key);

  const kickoff = (b: ClassifiedBet) =>
    (b.gameId === null ? null : games.get(b.gameId)?.start_ts) ?? "9999";
  const thisWeek = live
    .filter((b) => weekOf(b) === key)
    .sort((a, b) => kickoff(a).localeCompare(kickoff(b)) || a.placedAt.localeCompare(b.placedAt));
  // Tuesday through the following Monday, written the way the week-by-week section writes it.
  const monday = new Date(`${key}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + 6);
  const range = rangeLabel(key, monday.toISOString().slice(0, 10));

  const isAdmin = active.role === "admin" && viewerId !== null;
  const candidates = [
    ...(viewerId ? [{ id: viewerId, name: "Me" }] : []),
    ...(isAdmin
      ? sheet.members.filter((m) => m.userId !== viewerId).map((m) => ({ id: m.userId, name: m.name }))
      : []),
  ];
  const book = live.map((b) => ({ userId: b.userId, gameId: b.gameId, betType: b.betType, side: b.side }));

  const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TZ, weekday: "short" });
  const hrefFor = (k: string) => `/groups/${active.slug}/bets?wk=${k}`;
  const logFor = (memberId: string) => `/groups/${active.slug}?for=${memberId}#acting-heading`;

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

        <div className="mt-2 flex items-center justify-between gap-2">
          {prev ? (
            <Link
              href={hrefFor(prev)}
              aria-label="Previous week"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-chalk/20 text-chalk hover:border-chalk/50"
            >
              <ChevronLeft size={16} aria-hidden />
            </Link>
          ) : (
            <span className="min-w-11" aria-hidden />
          )}
          <div className="min-w-0 text-center">
            <h1 className="text-2xl">Who bet what</h1>
            <p className="stat text-xs text-chalk/50">
              {range}
              {key === currentKey ? " · this week" : ""} · CFB &amp; NFL
            </p>
          </div>
          {next ? (
            <Link
              href={hrefFor(next)}
              aria-label="Next week"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-chalk/20 text-chalk hover:border-chalk/50"
            >
              <ChevronRight size={16} aria-hidden />
            </Link>
          ) : (
            <span className="min-w-11" aria-hidden />
          )}
        </div>

        <p className="mt-3 mb-5 text-[11px] leading-relaxed text-dim">
          Every bet on a game that kicked off {range}, by person.
          {isAdmin
            ? " Tap + and a name to put the same bet on their ledger too — a tail that was texted but never logged."
            : " Tap + Me to tail one yourself."}{" "}
          Futures and bets on no game sit in no week and aren&rsquo;t listed.
        </p>

        <div className="flex flex-col gap-6">
          {sheet.members.map((m) => {
            const mine = thisWeek.filter((b) => b.userId === m.userId);
            const t = tally(
              mine
                .filter((b) => b.result !== null && b.result !== "void")
                .map((b) => ({ result: b.result, units: b.units, payoutUnits: b.payoutUnits, clv: b.clv })),
            );
            return (
              <section key={m.userId} aria-labelledby={`who-${m.userId}`}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 id={`who-${m.userId}`} className="text-sm text-accent">
                    <Link href={memberHref(active.slug, m.userId, null)} className="underline-offset-2 hover:underline">
                      {m.name}
                    </Link>
                    {m.userId === viewerId && (
                      <span className="stat ml-1.5 text-[10px] uppercase tracking-wider text-chalk/45">you</span>
                    )}
                  </h2>
                  <span className="stat text-[11px] text-dim">
                    {mine.length} {mine.length === 1 ? "bet" : "bets"}
                  </span>
                  <span className="h-px flex-1 bg-chalk/10" aria-hidden />
                  {t.decided > 0 && <RecordAndUnits t={t} />}
                </div>

                {mine.length === 0 ? (
                  <div className="card flex flex-wrap items-center justify-between gap-2 px-3.5 py-3">
                    <p className="text-sm text-chalk/60">Nothing logged for {m.name.split(" ")[0]} this week.</p>
                    {isAdmin && m.userId !== viewerId && (
                      <Link
                        href={logFor(m.userId)}
                        className="stat inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-accent underline-offset-2 hover:underline"
                      >
                        <PenLine size={13} aria-hidden />
                        Log one for {m.name.split(" ")[0]}
                      </Link>
                    )}
                  </div>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {mine.map((b) => {
                      const g = b.gameId === null ? undefined : games.get(b.gameId);
                      const home = g ? (abbr.get(g.home_team_id) ?? "?") : "?";
                      const away = g ? (abbr.get(g.away_team_id) ?? "?") : "?";
                      const raw = rawById.get(b.id);
                      const loggedBy =
                        raw?.logged_by && raw.logged_by !== b.userId ? sheet.nameById.get(raw.logged_by) : null;
                      const score =
                        g && g.status !== "scheduled" && g.home_points !== null && g.away_points !== null
                          ? `${away} ${g.away_points} @ ${home} ${g.home_points}${g.status === "final" ? " · final" : " · live"}`
                          : `${away} @ ${home}`;
                      const source = b.sourceUserId ? sheet.nameById.get(b.sourceUserId)?.split(" ")[0] : null;
                      const relation =
                        b.relation === "tail" && source
                          ? `tailed ${source}`
                          : b.relation === "fade" && source
                            ? `faded ${source}`
                            : b.relation === "origin" && b.tailedBy + b.fadedBy > 0
                              ? `${b.tailedBy} tailed, ${b.fadedBy} faded`
                              : null;
                      const targets = copyTargets(b, book, candidates);
                      const canVoid = viewerId !== null && (b.userId === viewerId || isAdmin) && b.result === null;
                      return (
                        <li key={b.id} className="card px-3 py-2">
                          <div className="flex items-center gap-x-3">
                            <span className="stat w-9 shrink-0 text-[11px] text-dim">
                              {g?.start_ts ? dayFmt.format(new Date(g.start_ts)) : "—"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="stat block text-sm text-chalk">
                                {betSideLabel(b.betType, b.side, b.line, home, away)}
                                <span className="ml-1.5 text-[11px] text-chalk/50">
                                  {b.units}u{b.odds !== -110 ? ` · ${fmtMoneyline(b.odds)}` : ""}
                                </span>
                              </span>
                              <span className="stat block text-[10.5px] text-chalk/45">
                                {sportOfSeasonId(b.seasonId).toUpperCase()} · {score}
                                {relation && ` · ${relation}`}
                                {loggedBy && ` · logged by ${loggedBy.split(" ")[0]}`}
                              </span>
                            </span>
                            {b.result && b.result !== "void" ? (
                              <ResultChip
                                label={b.result === "win" ? "Won" : b.result === "loss" ? "Lost" : "Push"}
                                result={b.result === "win" ? "pass" : b.result === "loss" ? "fail" : "push"}
                              />
                            ) : (
                              <span className="stat shrink-0 text-[11px] text-chalk/40">open</span>
                            )}
                          </div>
                          {(targets.length > 0 || canVoid) && (
                            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-chalk/5 pt-1">
                              <CopyBetButtons betId={b.id} targets={targets} />
                              {canVoid && (
                                <span className="ml-auto">
                                  <VoidBetButton
                                    betId={b.id}
                                    forUserId={b.userId === viewerId ? null : b.userId}
                                  />
                                </span>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        {thisWeek.length === 0 && keysWithBets.length > 0 && (
          <p className="mt-4 text-center text-xs text-dim">
            Nobody has a bet in this week yet.
          </p>
        )}
      </main>
    </div>
  );
}

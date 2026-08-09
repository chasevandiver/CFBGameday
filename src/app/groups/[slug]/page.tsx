import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../components/AppNav";
import { GroupSwitcher, JoinCode } from "../../../components/group/GroupForms";
import { PickButtons } from "../../../components/PickButtons";
import { ShareButton } from "../../../components/ShareButton";
import type { PickRow } from "../../../lib/db-types";
import {
  fetchGroupMembers,
  hasPricedMarket,
  fetchGroupWeek,
  resolveActiveGroup,
} from "../../../lib/groups";
import { DEFAULT_TZ, kickParts } from "../../../lib/kick";
import { pickKey } from "../../../lib/session-picks";
import type { SharePick } from "../../../lib/share-text";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../../lib/queries";
import { byLeagueRules, EMPTY_TALLY, formatRecord, tally, tallyBy } from "../../../lib/records";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: slug };
}

/**
 * A group's board: the standings, then this week's games — only the ones the
 * admin put in play, with only the markets they turned on.
 *
 * This is the one place picks are made. The slate stays the whole slate and
 * shows what you took; here the set is narrowed to the group's format, which
 * is the difference between "every game this Saturday" and "the eight we're
 * playing".
 */
export default async function GroupBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { slug } = await params;
  const { week: weekParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { active, mine } = await resolveActiveGroup(supabase, user?.id ?? null, slug);
  // RLS hides a private group from a non-member, so "not found" and "not yours"
  // are deliberately the same answer.
  if (!active || active.slug !== slug) notFound();

  const { seasonId, week: currentWeek, seasonType } = await fetchCurrentSeasonWeek(supabase);
  const parsed = Number(weekParam);
  const week = Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : currentWeek;

  const [groupWeek, members, slate, joinRes, seasonPicksRes, lifetimeRes] = await Promise.all([
    fetchGroupWeek(supabase, active.id, seasonId, week, seasonType),
    fetchGroupMembers(supabase, active.id),
    fetchSlateView(supabase, seasonId, week, user?.id ?? null, seasonType, active.id),
    active.role === "admin"
      ? supabase.from("groups").select("join_code").eq("id", active.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("picks")
      .select("user_id, result, units, clv")
      .eq("group_id", active.id)
      .eq("season_id", seasonId),
    // Lifetime spans seasons — a group has no season_id precisely so this
    // question stays answerable across them.
    user
      ? supabase
          .from("picks")
          .select("result, units, clv")
          .eq("group_id", active.id)
          .eq("user_id", user.id)
      : Promise.resolve({ data: [] }),
  ]);

  const inPlay = new Set(groupWeek?.gameIds ?? []);
  const boardGames = slate.games.filter((g) => inPlay.has(g.id));

  // Every pick this group has made this week, so a card can show all of the
  // viewer's markets rather than the single headline the slate keeps.
  const { data: weekPickRows } = await supabase
    .from("picks")
    .select("*")
    .eq("group_id", active.id)
    .in("game_id", boardGames.length > 0 ? boardGames.map((g) => g.id) : [-1]);
  const weekPicks = (weekPickRows ?? []) as PickRow[];
  const minePerGame = new Map<number, PickRow[]>();
  for (const p of weekPicks) {
    if (p.user_id !== user?.id) continue;
    minePerGame.set(p.game_id, [...(minePerGame.get(p.game_id) ?? []), p]);
  }

  // Share context. "Today" is the viewer's own picks on games kicking off
  // today in their timezone — the day they would be texting about.
  const gameById = new Map(slate.games.map((g) => [g.id, g]));
  const todayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date());
  const isToday = (iso: string | null) =>
    iso !== null &&
    new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ }).format(new Date(iso)) ===
      new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ }).format(new Date());
  const myWeekPicks = weekPicks.filter((p) => p.user_id === user?.id);
  const todayPicks: SharePick[] = myWeekPicks
    .filter((p) => isToday(gameById.get(p.game_id)?.startTs ?? null))
    .map((p) => {
      const g = gameById.get(p.game_id)!;
      return {
        key: pickKey(p.game_id, p.market),
        market: p.market,
        side: p.side,
        line: p.line_at_pick === null ? null : Number(p.line_at_pick),
        homeAbbr: g.home.abbr,
        awayAbbr: g.away.abbr,
      };
    });
  const myTodayRows = myWeekPicks.filter((p) =>
    isToday(gameById.get(p.game_id)?.startTs ?? null),
  );

  const tallies = tallyBy(
    (seasonPicksRes.data ?? []) as Array<Pick<PickRow, "user_id" | "result" | "units" | "clv">>,
    (p) => p.user_id,
  );
  const standings = members
    .map((m) => ({ ...m, ...(tallies.get(m.userId) ?? EMPTY_TALLY) }))
    .sort(byLeagueRules);

  const joinCode = (joinRes.data as { join_code: string } | null)?.join_code ?? null;

  // Straight-up takes no number, so a winners-only week grades no units, no ROI
  // and no CLV. Those columns are inapplicable rather than empty, and a column
  // of dashes is a question the reader has to answer.
  const priced = groupWeek === null || hasPricedMarket(groupWeek.markets);
  const myPickCount = myWeekPicks.length;
  const minPicks = groupWeek?.minPicks ?? 0;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <GroupSwitcher groups={mine} activeSlug={slug} />

        <div className="mt-2 mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">{active.name}</h1>
          <p className="stat text-xs text-chalk/50">
            {members.length} {members.length === 1 ? "member" : "members"}
            {active.visibility === "public" ? " · public" : " · members only"}
          </p>
        </div>

        <nav className="mb-5 flex flex-wrap items-center gap-2 text-xs">
          <Link
            href={`/groups/${slug}/week/${week}`}
            className="stat min-h-11 rounded-lg border border-chalk/20 px-3 py-2 text-chalk hover:border-chalk/50"
          >
            Week {week} picks
          </Link>
          {active.role === "admin" && (
            <Link
              href={`/groups/${slug}/settings?week=${week}`}
              className="stat min-h-11 rounded-lg border border-chalk/20 px-3 py-2 text-chalk hover:border-chalk/50"
            >
              Set the week
            </Link>
          )}
          {joinCode && <JoinCode code={joinCode} />}
          {user && (
            <ShareButton
              context={{
                groupName: active.name,
                userName: members.find((m) => m.userId === user.id)?.name ?? "Me",
                week,
                day: todayLabel,
                today: todayPicks,
                dayRecord: tally(myTodayRows),
                weekRecord: tally(myWeekPicks),
                lifetimeRecord: tally(
                  (lifetimeRes.data ?? []) as Array<
                    Pick<PickRow, "result" | "units" | "clv">
                  >,
                ),
              }}
            />
          )}
        </nav>

        {/* ---- standings ---- */}
        <section className="card mb-6 overflow-hidden">
          <h2 className="border-b border-chalk/8 px-4 py-3 text-sm text-accent">Season</h2>
          <table className="stats w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-chalk/40">
              <tr className="border-b border-chalk/8">
                <th className="px-4 py-2 text-left font-semibold">Member</th>
                <th className="px-3 py-2 text-right font-semibold">Record</th>
                {priced && (
                  <>
                    <th className="px-3 py-2 text-right font-semibold">Units</th>
                    <th className="px-4 py-2 text-right font-semibold">CLV</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {standings.map((r) => (
                <tr key={r.userId} className="border-b border-chalk/5 last:border-0">
                  <td className="px-4 py-2 font-sans text-chalk">
                    {r.name}
                    {r.role === "admin" && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wider text-chalk/40">
                        admin
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.decided > 0 ? formatRecord(r) : "—"}
                  </td>
                  {priced && (
                    <>
                      <td
                        className={`px-3 py-2 text-right ${r.units > 0 ? "text-win" : r.units < 0 ? "text-loss" : ""}`}
                      >
                        {r.decided > 0 ? `${r.units >= 0 ? "+" : ""}${r.units.toFixed(1)}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {r.avgClv === null
                          ? "—"
                          : `${r.avgClv > 0 ? "+" : ""}${r.avgClv.toFixed(2)}`}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ---- this week's board ---- */}
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm text-accent">Week {week}</h2>
          {groupWeek && (
            <p className="stat text-xs text-chalk/50">
              {describeFormat(groupWeek)}
              {groupWeek.minPicks > 0 ? ` · ${groupWeek.minPicks} min` : ""}
              {groupWeek.locked ? " · locked" : ""}
            </p>
          )}
        </div>

        {!user && groupWeek !== null && boardGames.length > 0 && (
          <p className="card mb-3 px-4 py-3 text-sm text-dim">
            <Link
              href="/login"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Sign in
            </Link>{" "}
            to pick — the line snapshots the moment you tap.
          </p>
        )}

        {minPicks > 0 && user && groupWeek !== null && (
          <p
            className={`stat mb-2 text-xs ${myPickCount >= minPicks ? "text-dim" : "text-accent"}`}
          >
            {myPickCount} of {minPicks} picks in
            {myPickCount >= minPicks ? " — you're good" : ""}
          </p>
        )}

        {groupWeek === null ? (
          <section className="card px-6 py-10 text-center">
            <p className="text-sm text-chalk">Week {week} isn&rsquo;t set up yet.</p>
            <p className="mt-1 text-sm text-dim">
              {active.role === "admin" ? (
                <Link
                  href={`/groups/${slug}/settings?week=${week}`}
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  Choose the games and bet types
                </Link>
              ) : (
                "Your admin hasn't picked the games yet."
              )}
            </p>
          </section>
        ) : boardGames.length === 0 ? (
          <section className="card px-6 py-10 text-center">
            <p className="text-sm text-dim">No games in play for week {week}.</p>
          </section>
        ) : (
          <ul className="flex flex-col gap-3">
            {boardGames.map((g) => {
              const kick = g.startTs === null ? null : kickParts(g.startTs, DEFAULT_TZ);
              const takers = weekPicks.filter((p) => p.game_id === g.id);
              return (
                <li key={g.id} className="card px-4 py-3.5">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <Link href={`/game/${g.id}`} className="min-w-0 font-medium text-chalk">
                      {g.away.abbr} <span className="text-dim">at</span> {g.home.abbr}
                    </Link>
                    <span className="stat shrink-0 text-xs text-dim">
                      {g.status === "final"
                        ? `Final ${g.awayPoints}–${g.homePoints}`
                        : g.status === "in_progress"
                          ? `${g.awayPoints}–${g.homePoints} live`
                          : kick
                            ? `${kick.day} ${kick.time}`
                            : "TBD"}
                    </span>
                  </div>
                  {user && (
                  <PickButtons
                    groupId={active.id}
                    gameId={g.id}
                    homeLabel={g.home.abbr}
                    awayLabel={g.away.abbr}
                    currentSpread={g.lines.spread}
                    currentTotal={g.lines.total}
                    markets={groupWeek.markets}
                    myPicks={(minePerGame.get(g.id) ?? []).map((p) => ({
                      market: p.market,
                      side: p.side,
                      line_at_pick: p.line_at_pick === null ? null : Number(p.line_at_pick),
                      result: p.result,
                      clv: p.clv === null ? null : Number(p.clv),
                    }))}
                    kickoffPassed={g.startTs !== null && new Date(g.startTs) <= new Date()}
                    kickoffTs={g.startTs}
                    signedIn
                  />
                  )}
                  {takers.length > 0 && (
                    <p className="stat mt-2 truncate text-[11px] text-dim">
                      {takers.length} {takers.length === 1 ? "pick" : "picks"} in
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}

function describeFormat(w: {
  selectionMode: string;
  conference: string | null;
  markets: string[];
  gameIds: number[];
}): string {
  const games =
    w.selectionMode === "full_slate"
      ? "full slate"
      : w.selectionMode === "conference"
        ? (w.conference ?? "conference")
        : `${w.gameIds.length} ${w.gameIds.length === 1 ? "game" : "games"}`;
  const markets = w.markets
    .map((m) => (m === "straight_up" ? "winners" : m === "total" ? "totals" : "spreads"))
    .join(" + ");
  return `${games} · ${markets}`;
}

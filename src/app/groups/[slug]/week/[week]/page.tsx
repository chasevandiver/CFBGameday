import { EyeOff } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "../../../../../components/AppNav";
import {
  MatchupCard,
  type MatchupPick,
} from "../../../../../components/group/MatchupCard";
import { CancelPickButton } from "../../../../../components/group/CancelPickButton";
import { PoolMachine } from "../../../../../components/group/PoolMachine";
import type { CoverFlipRow, PickRow } from "../../../../../lib/db-types";
import type { PickMarket } from "../../../../../lib/grade";
import { fetchGroupMembers, fetchGroupWeek, groupLeague, resolveActiveGroup } from "../../../../../lib/groups";
import { impliedHomeProb } from "../../../../../lib/pool-odds";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../../../../lib/queries";
import { EMPTY_TALLY, formatRecord, tallyBy } from "../../../../../lib/records";
import { isDead, pickSideLabel, type GameView } from "../../../../../lib/slate";
import { createClient } from "../../../../../lib/supabase/server";
import {
  parseWeekRef,
  seasonWeeks,
  weekIndex,
  weekLabel,
  type WeekRef,
} from "../../../../../lib/group-weeks";
import { isValidWeek } from "../../../../../lib/week-range";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  return { title: `Week ${week} picks` };
}

type View = "person" | "pick";

/**
 * The week's picks, generated from what people actually placed. Two readings
 * of one dataset:
 *
 *   by person — everything one member took, with their week and lifetime record
 *   by pick   — every game, with who is on which side
 *
 * The view is a search param rather than client state so a link opens the one
 * you were looking at.
 *
 * Picks on games the admin dropped before the freeze are kept and shown, greyed
 * and marked, but excluded from every record. Deleting them would rewrite what
 * somebody did to suit a later config change; hiding them would make a record
 * that doesn't add up.
 */
export default async function GroupWeekPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; week: string }>;
  searchParams: Promise<{ view?: string; st?: string; league?: string }>;
}) {
  const { slug, week: weekStr } = await params;
  const { view: viewParam, st: stRaw, league: leagueParam } = await searchParams;
  const view: View = viewParam === "pick" ? "pick" : "person";

  const week = Number(weekStr);
  if (!isValidWeek(week)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { active } = await resolveActiveGroup(supabase, user?.id ?? null, slug);
  if (!active || active.slug !== slug) notFound();
  // Pick'em only — neither a betting group nor a survivor pool has a weekly
  // board of picks to list.
  if (active.kind !== "pickem") redirect(`/groups/${slug}`);

  const league = groupLeague(leagueParam, active.leagues);
  const { seasonId, week: currentWeek, seasonType: currentType, minWeek } =
    await fetchCurrentSeasonWeek(supabase, league);
  // `?st=` decides which part of the calendar `[week]` names. Without it this
  // page read the live pointer, so in August a URL saying week 2 rendered the
  // preseason's week 2 — see lib/group-weeks.ts.
  const weeks = seasonWeeks(league, minWeek);
  const ref = parseWeekRef(String(week), stRaw, weeks, {
    seasonType: currentType,
    week: currentWeek,
  });
  const seasonType = ref.seasonType;
  const i = weekIndex(weeks, ref);
  const prevWeek = i > 0 ? weeks[i - 1] : null;
  const nextWeek = i >= 0 && i < weeks.length - 1 ? weeks[i + 1] : null;
  const nav = (w: WeekRef) =>
    `/groups/${slug}/week/${w.week}?${new URLSearchParams({
      ...(viewParam ? { view: viewParam } : {}),
      ...(w.seasonType === "preseason" ? { st: "pre" } : w.seasonType === "postseason" ? { st: "post" } : {}),
      ...(league === "nfl" ? { league: "nfl" } : {}),
    }).toString()}`;
  const [groupWeek, members, slate, lifetimeRes] = await Promise.all([
    fetchGroupWeek(supabase, active.id, seasonId, week, seasonType),
    fetchGroupMembers(supabase, active.id),
    fetchSlateView(supabase, seasonId, week, user?.id ?? null, seasonType, active.id),
    supabase
      .from("picks")
      .select("user_id, result, units, clv")
      .eq("group_id", active.id),
  ]);

  const gameById = new Map(slate.games.map((g) => [g.id, g]));
  const { data: pickRows } = await supabase
    .from("picks")
    .select("*")
    .eq("group_id", active.id)
    .in("game_id", slate.games.length > 0 ? slate.games.map((g) => g.id) : [-1]);
  const picks = (pickRows ?? []) as PickRow[];

  // Late cover swings on this week's board (0026). Neutral rows; the card
  // turns them into "burned: Jeff" using picks it already has.
  const { data: flipRows } = await supabase
    .from("cover_flips")
    .select("*")
    .in("game_id", slate.games.length > 0 ? slate.games.map((g) => g.id) : [-1])
    .order("detected_at", { ascending: true });
  const flipsByGame = new Map<number, CoverFlipRow[]>();
  for (const f of (flipRows ?? []) as CoverFlipRow[]) {
    const arr = flipsByGame.get(f.game_id) ?? [];
    arr.push(f);
    flipsByGame.set(f.game_id, arr);
  }

  const inPlay = new Set(groupWeek?.gameIds ?? []);
  const markets = new Set(groupWeek?.markets ?? []);
  /** A pick counts when its game is still on the board and its market is on. */
  const counts = (p: PickRow) => inPlay.has(p.game_id) && markets.has(p.market);

  const weekTallies = tallyBy(picks.filter(counts), (p) => p.user_id);
  const lifetimeTallies = tallyBy(
    (lifetimeRes.data ?? []) as Array<Pick<PickRow, "user_id" | "result" | "units" | "clv">>,
    (p) => p.user_id,
  );
  const nameOf = new Map(members.map((m) => [m.userId, m.name]));

  const orphans = picks.filter((p) => !counts(p));

  // The matchup view shows every game on the board, not only the picked ones —
  // "the matchups of the week" includes the ones nobody has touched yet.
  const boardGames = slate.games.filter((g) => inPlay.has(g.id));
  const droppedGameIds = [...new Set(orphans.map((p) => p.game_id))].filter(
    (id) => !inPlay.has(id),
  );
  const matchups = [
    ...boardGames.map((g) => ({ game: g, dropped: false })),
    ...droppedGameIds
      .map((id) => gameById.get(id))
      .filter((g): g is GameView => g !== undefined)
      .map((g) => ({ game: g, dropped: true })),
  ];

  // With the blind on, RLS returns other members' rows only once a game has
  // kicked off — so the page cannot count them itself and asks the database,
  // which will say how many without saying who or what.
  const blindFor = (g: GameView) =>
    active.picksHiddenUntilKickoff && !(g.startTs !== null && new Date(g.startTs) <= new Date());
  // 09:P-9: one call for the whole board, not one per game. This used to be a
  // Promise.all over `group_game_pick_count`, which is a separate PostgREST
  // request per hidden game — 60 on a full CFB slate, 91 on the Week 1 NFL
  // board (DB-7). `group_game_pick_counts` (0051) answers for all of them at
  // once and returns a row per game asked about, zeros included, so a game
  // nobody has picked lands in the Map as 0 rather than going missing.
  const blindCounts = new Map<number, number>();
  if (active.picksHiddenUntilKickoff && user) {
    const blindIds = matchups.filter(({ game }) => blindFor(game)).map(({ game }) => game.id);
    if (blindIds.length > 0) {
      const { data } = await supabase.rpc("group_game_pick_counts", {
        p_group: active.id,
        p_games: blindIds,
      });
      for (const row of (data ?? []) as Array<{ game_id: number; n: number }>) {
        blindCounts.set(row.game_id, Number(row.n ?? 0));
      }
    }
  }

  // The Pool Machine + win-the-week % (R2-D2/D3): the page hands the client
  // component exactly what it already renders — graded tallies, the visible
  // ungraded picks, and one outcome probability per remaining game (frozen
  // prediction where there is one, market-implied otherwise).
  const pendingPicks = picks
    .filter(counts)
    .filter((p) => p.result === null)
    .filter((p) => {
      const g = gameById.get(p.game_id);
      return g !== undefined && g.status !== "final" && !isDead(g);
    })
    .map((p) => ({
      userId: p.user_id,
      gameId: p.game_id,
      market: p.market as PickMarket,
      side: p.side,
      units: Number(p.units ?? 1),
    }));
  const machineGameIds = new Set(pendingPicks.map((p) => p.gameId));
  const machineGames = boardGames
    .filter((g) => machineGameIds.has(g.id))
    .map((g) => ({
      id: g.id,
      awayAbbr: g.away.abbr,
      homeAbbr: g.home.abbr,
      homeWinProb: g.prediction?.homeWinProb ?? impliedHomeProb(g.lines.spread),
    }));

  const toMatchupPick = (p: PickRow): MatchupPick => ({
    id: p.id,
    userId: p.user_id,
    name: nameOf.get(p.user_id) ?? "—",
    market: p.market,
    side: p.side,
    line: p.line_at_pick === null ? null : Number(p.line_at_pick),
    result: p.result,
  });

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          {/* the Sunday flow is "how did last week go" — weeks must be walkable */}
          <span className="flex items-center gap-1">
            {prevWeek && (
              <Link
                href={nav(prevWeek)}
                aria-label={weekLabel(prevWeek, league)}
                className="stat inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-accent hover:underline"
              >
                ‹
              </Link>
            )}
            <h1 className="text-2xl">{weekLabel(ref, league)}</h1>
            {nextWeek && (
              <Link
                href={nav(nextWeek)}
                aria-label={weekLabel(nextWeek, league)}
                className="stat inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-accent hover:underline"
              >
                ›
              </Link>
            )}
          </span>
          <Link
            href={`/groups/${slug}`}
            className="stat -my-2 inline-flex min-h-11 items-center text-xs text-accent hover:underline"
          >
            {active.name} →
          </Link>
        </div>
        <p className="mb-4 text-sm text-dim">
          {picks.length} {picks.length === 1 ? "pick" : "picks"} from {members.length}{" "}
          {members.length === 1 ? "member" : "members"}
          {orphans.length > 0 && ` · ${orphans.length} no longer in play`}
        </p>

        <PoolMachine
          members={members.map((m) => ({ userId: m.userId, name: m.name }))}
          base={[...weekTallies.entries()]}
          pending={pendingPicks}
          games={machineGames}
          viewerId={user?.id ?? null}
          hiddenNote={active.picksHiddenUntilKickoff}
        />

        <div className="mb-5 flex gap-2" role="group" aria-label="View">
          <ViewTab slug={slug} week={week} view="person" active={view === "person"}>
            By person
          </ViewTab>
          <ViewTab slug={slug} week={week} view="pick" active={view === "pick"}>
            By pick
          </ViewTab>
        </div>

        {matchups.length === 0 ? (
          <section className="card px-6 py-10 text-center">
            <p className="text-sm text-dim">
              {groupWeek === null
                ? `${active.name} hasn't set up ${weekLabel(ref, league).toLowerCase()} yet.`
                : `No games in play for ${weekLabel(ref, league).toLowerCase()}.`}
            </p>
          </section>
        ) : view === "person" && picks.length === 0 ? (
          <section className="card px-6 py-10 text-center">
            <p className="text-sm text-dim">
            No picks in yet for {weekLabel(ref, league).toLowerCase()}.
          </p>
          </section>
        ) : view === "person" ? (
          <ul className="flex flex-col gap-3">
            {members
              .map((m) => ({ m, mine: picks.filter((p) => p.user_id === m.userId) }))
              .filter((x) => x.mine.length > 0)
              .sort((a, b) => b.mine.length - a.mine.length || a.m.name.localeCompare(b.m.name))
              .map(({ m, mine }) => {
                const w = weekTallies.get(m.userId) ?? EMPTY_TALLY;
                const life = lifetimeTallies.get(m.userId) ?? EMPTY_TALLY;
                return (
                  <li key={m.userId} className="card overflow-hidden">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-chalk/8 px-4 py-3">
                      <h2 className="font-medium text-chalk">{m.name}</h2>
                      <p className="stat text-xs text-dim">
                        {w.decided === 0 && life.decided === 0 ? (
                          "nothing graded yet"
                        ) : (
                          <>
                            <span className="text-chalk">
                              {w.decided > 0 ? formatRecord(w) : "0-0"}
                            </span>{" "}
                            this week · {life.decided > 0 ? formatRecord(life) : "0-0"} lifetime
                          </>
                        )}
                      </p>
                    </div>
                    <ul>
                      {mine.map((p) => (
                        <li
                          key={p.id}
                          className={`flex items-baseline justify-between gap-3 border-b border-chalk/5 px-4 py-2 last:border-0 ${
                            counts(p) ? "" : "opacity-45"
                          }`}
                        >
                          <span className="stat min-w-0 truncate text-sm text-chalk">
                            {pickText(p, gameById.get(p.game_id))}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {counts(p) ? (
                              <ResultText p={p} />
                            ) : (
                              <span className="stat text-[10px] uppercase tracking-wider text-chalk/40">
                                not in play
                              </span>
                            )}
                            {/* ADM-2. Group admins only, and with no kickoff
                                gate — a pick that has to be cancelled after
                                the game started is the whole reason the RPC
                                exists (remove_pick raises there). */}
                            {active.role === "admin" && (
                              <CancelPickButton
                                groupId={active.id}
                                userId={p.user_id}
                                gameId={p.game_id}
                                market={p.market as PickMarket}
                                label={pickText(p, gameById.get(p.game_id))}
                              />
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
          </ul>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.picksHiddenUntilKickoff && (
              <li className="card flex items-center gap-2 px-3.5 py-2.5">
                <EyeOff size={13} aria-hidden className="shrink-0 text-dim" />
                <p className="text-xs text-dim">
                  {user
                    ? "Everyone's picks stay hidden until each game kicks off. Yours are always yours to see."
                    : "Everyone's picks stay hidden until each game kicks off."}
                </p>
              </li>
            )}
            {matchups.map(({ game, dropped }) => (
              <MatchupCard
                key={game.id}
                game={game}
                picks={picks.filter((p) => p.game_id === game.id).map(toMatchupPick)}
                viewerId={user?.id ?? null}
                markets={groupWeek?.markets ?? []}
                blind={blindFor(game)}
                blindCount={user ? (blindCounts.get(game.id) ?? 0) : null}
                dropped={dropped}
                flips={flipsByGame.get(game.id) ?? []}
              />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function ViewTab({
  slug,
  week,
  view,
  active,
  children,
}: {
  slug: string;
  week: number;
  view: View;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/groups/${slug}/week/${week}?view=${view}`}
      aria-current={active ? "page" : undefined}
      className={`stat flex min-h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${
        active
          ? "border-accent bg-accent/15 text-accent"
          : "border-chalk/20 text-dim hover:border-chalk/50"
      }`}
    >
      {children}
    </Link>
  );
}

function ResultText({ p }: { p: PickRow }) {
  // Nothing, not a dot: an ungraded pick has no result, and a stray glyph in
  // the result column reads as one. A VOID does get shown — it is a decided
  // outcome, and hiding it made a pick voided by Rule #4 look ungraded.
  if (!p.result) return null;
  const tone =
    p.result === "win" ? "text-win" : p.result === "loss" ? "text-loss" : "text-push";
  return <span className={`stat text-xs font-semibold uppercase ${tone}`}>{p.result}</span>;
}

/** "UGA -6.5 vs BAMA" — the side, the number taken, and enough of the game to place it. */
function pickText(p: PickRow, g: GameView | undefined): string {
  if (!g) return "—";
  return `${sideText(p, g)}  ${g.away.abbr}/${g.home.abbr}`;
}

function sideText(p: PickRow, g: GameView): string {
  return pickSideLabel(p.market, p.side, p.line_at_pick, g.home.abbr, g.away.abbr, {
    compact: true,
  });
}

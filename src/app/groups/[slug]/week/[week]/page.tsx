import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../../../components/AppNav";
import type { PickRow } from "../../../../../lib/db-types";
import { fetchGroupMembers, fetchGroupWeek, resolveActiveGroup } from "../../../../../lib/groups";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../../../../lib/queries";
import { EMPTY_TALLY, formatRecord, tallyBy } from "../../../../../lib/records";
import { fmtSpread, fmtTotal, lineForSide, type GameView } from "../../../../../lib/slate";
import { createClient } from "../../../../../lib/supabase/server";

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
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug, week: weekStr } = await params;
  const { view: viewParam } = await searchParams;
  const view: View = viewParam === "pick" ? "pick" : "person";

  const week = Number(weekStr);
  if (!Number.isInteger(week) || week < 1 || week > 20) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { active } = await resolveActiveGroup(supabase, user?.id ?? null, slug);
  if (!active || active.slug !== slug) notFound();

  const { seasonId, seasonType } = await fetchCurrentSeasonWeek(supabase);
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

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">Week {week}</h1>
          <Link href={`/groups/${slug}`} className="stat text-xs text-accent hover:underline">
            {active.name} →
          </Link>
        </div>
        <p className="mb-4 text-sm text-dim">
          {picks.length} {picks.length === 1 ? "pick" : "picks"} from {members.length}{" "}
          {members.length === 1 ? "member" : "members"}
          {orphans.length > 0 && ` · ${orphans.length} no longer in play`}
        </p>

        <div className="mb-5 flex gap-2" role="group" aria-label="View">
          <ViewTab slug={slug} week={week} view="person" active={view === "person"}>
            By person
          </ViewTab>
          <ViewTab slug={slug} week={week} view="pick" active={view === "pick"}>
            By pick
          </ViewTab>
        </div>

        {picks.length === 0 ? (
          <section className="card px-6 py-10 text-center">
            <p className="text-sm text-dim">No picks in yet for week {week}.</p>
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
                        <span className="text-chalk">
                          {w.decided > 0 ? formatRecord(w) : "—"}
                        </span>{" "}
                        this week · {life.decided > 0 ? formatRecord(life) : "—"} lifetime
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
                          <span className="shrink-0">
                            {counts(p) ? (
                              <ResultText p={p} />
                            ) : (
                              <span className="stat text-[10px] uppercase tracking-wider text-chalk/40">
                                not in play
                              </span>
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
            {byPick(picks, slate.games, inPlay).map(({ game, market, takers }) => (
              <li key={`${game.id}:${market}`} className="card px-4 py-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <Link href={`/game/${game.id}`} className="min-w-0 font-medium text-chalk">
                    {game.away.abbr} <span className="text-dim">at</span> {game.home.abbr}
                  </Link>
                  <span className="stat shrink-0 text-[10px] uppercase tracking-wider text-chalk/40">
                    {market === "straight_up" ? "winner" : market}
                  </span>
                </div>
                <ul className="flex flex-col gap-1">
                  {takers.map((p) => (
                    <li
                      key={p.id}
                      className={`flex items-baseline justify-between gap-3 text-sm ${
                        inPlay.has(p.game_id) && markets.has(p.market) ? "" : "opacity-45"
                      }`}
                    >
                      <span className="min-w-0 truncate font-sans text-chalk">
                        {nameOf.get(p.user_id) ?? "—"}
                      </span>
                      <span className="stat shrink-0 text-dim">
                        {sideText(p, game)} <ResultText p={p} />
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
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
  if (!p.result || p.result === "void") return <span className="text-chalk/30">·</span>;
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
  const team = p.side === "home" ? g.home.abbr : g.away.abbr;
  if (p.market === "straight_up") return `${team} to win`;
  if (p.market === "spread") return `${team} ${fmtSpread(lineForSide(p.side, p.line_at_pick))}`;
  return `${p.side === "over" ? "O" : "U"} ${fmtTotal(p.line_at_pick)}`;
}

/**
 * One row per game and market that anybody took, board games first so the
 * week reads in order and the dropped ones settle at the bottom.
 */
function byPick(picks: PickRow[], games: GameView[], inPlay: Set<number>) {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const groups = new Map<string, { game: GameView; market: string; takers: PickRow[] }>();
  for (const p of picks) {
    const game = gameById.get(p.game_id);
    if (!game) continue;
    const key = `${p.game_id}:${p.market}`;
    const entry = groups.get(key) ?? { game, market: p.market, takers: [] };
    entry.takers.push(p);
    groups.set(key, entry);
  }
  return [...groups.values()]
    .map((e) => ({
      ...e,
      takers: e.takers.sort((a, b) => a.side.localeCompare(b.side)),
    }))
    .sort((a, b) => {
      const live = Number(inPlay.has(b.game.id)) - Number(inPlay.has(a.game.id));
      if (live !== 0) return live;
      return (a.game.startTs ?? "").localeCompare(b.game.startTs ?? "");
    });
}

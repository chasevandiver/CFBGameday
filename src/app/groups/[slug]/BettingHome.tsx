import { PenLine, Ticket, Users } from "lucide-react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BetForm } from "../../../components/BetForm";
import { VoidBetButton } from "../../../components/VoidBetButton";
import { GroupArcade } from "../../../components/games/GroupArcade";
import { GroupSwitcher, JoinCode } from "../../../components/group/GroupForms";
import { GroupRoster } from "../../../components/group/GroupRoster";
import { LeagueTabs } from "../../../components/group/LeagueTabs";
import {
  PairPanel,
  SheetGameRow,
  SourceCard,
} from "../../../components/group/BettingHub";
import {
  GroupWeekRecords,
  type GroupWeekRow,
} from "../../../components/group/GroupWeekRecords";
import { LiveRefresh } from "../../../components/LiveRefresh";
import { ShareImageButton } from "../../../components/ShareImageButton";
import { ShareSheetButton } from "../../../components/group/ShareSheetButton";
import { WeekJump } from "../../../components/group/WeekJump";
import { fetchBetFormOptions } from "../../../lib/bet-form-games";
import { betsInLeague, byUnitsIn, fetchBettingSheet } from "../../../lib/betting-groups";
import { outsideWeekIds } from "../../../lib/home";
import { weekLabel, weekQuery, type WeekRef } from "../../../lib/group-weeks";
import { EMPTY_TALLY } from "../../../lib/records";
import {
  memberRecords,
  refreshTier,
  sliceRecord,
  standingOf,
  undatedCount,
  weekBuckets,
  type WeekWager,
} from "../../../lib/week-records";
import type { GroupSummary } from "../../../lib/groups";
import type { BetRow } from "../../../lib/db-types";
import type { Sport } from "../../../lib/league";
import { buildSheetShareContext } from "../../../lib/group-share";
import { DEFAULT_TZ, tzLabel } from "../../../lib/kick";
import {
  betsCardPayload,
  shareableBets,
  type BetCardGame,
} from "../../../lib/share-card-build";
import { fetchSlateView, WEEK_NONE } from "../../../lib/queries";
import type { SeasonType } from "../../../lib/season";
import { pairStatsFor } from "../../../lib/tailing";

/**
 * A betting group's home.
 *
 * No board, no admin week to set, nothing to submit — a betting group is its
 * members' ledgers read side by side. So the page is: what's on the sheet this
 * week, who's running good, and who is actually worth copying.
 *
 * One league at a time (GRP-12). The members bet both, and the season numbers
 * below count both, but a *week* only exists on one league's calendar — NFL
 * week 2 and CFB week 3 are the same weekend, and neither has the other's
 * preseason or playoffs. So the sheet is one league's week, chosen by the
 * tabs, the way a both-league pick'em group shows one board at a time.
 *
 * The last of those is the point. Everyone in a group chat claims a record;
 * "how does tailing you actually go" is a different number, and it is the one
 * nobody can argue with.
 */
export async function BettingHome({
  supabase,
  group,
  mine,
  userId,
  league,
  seasonId,
  week,
  seasonType,
  weeks,
  weekRef,
  forParam = null,
}: {
  supabase: SupabaseClient;
  group: GroupSummary;
  mine: GroupSummary[];
  userId: string | null;
  /** The league in view; `seasonId`, `week` and `weeks` are all its own. */
  league: Sport;
  seasonId: number;
  week: number;
  seasonType: SeasonType;
  /** The league's calendar in playing order — preseason weeks included, which
   *  a betting group very much does play. */
  weeks: WeekRef[];
  weekRef: WeekRef;
  /** `?for=`: the member an admin is logging bets for (0083). */
  forParam?: string | null;
}) {
  const leagueParam = league === "nfl" ? "nfl" : null;
  /* Every road to the slate from here opens the league in view: a reader on
     the NFL tab who taps "Go bet the slate" and lands on Saturday's games has
     been told, wrongly, that this is a CFB product. */
  const slateHref = league === "nfl" ? "/slate?sport=nfl" : "/slate";

  const [sheet, slate, joinRes] = await Promise.all([
    fetchBettingSheet(supabase, group.id, seasonId),
    // The slate already knows how to classify a betting group's bets per game
    // — same call the slate page makes, so the week's sheet here and the cards
    // there can never disagree about who was first.
    fetchSlateView(supabase, seasonId, week, userId, seasonType, null, group.id),
    group.role === "admin"
      ? supabase.from("groups").select("join_code").eq("id", group.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  /* GRP-6 tried to show both leagues on one sheet by sweeping in whatever the
     group had money on between this week's first and last kickoff. Those were
     CFB kickoffs — Thursday to Saturday night — so an NFL Sunday or Monday
     game was never inside the window, and every NFL bet but the Thursday one
     stayed invisible. GRP-12 gives each league its own tab and own week
     instead; the sweep below stays, but within the league in view: it exists
     for a bet on a game whose `week` differs from this one while its kickoff
     does not (a rescheduled game), not for crossing leagues. */
  const onSlate = new Set(slate.games.map((g) => g.id));
  const kickoffs = slate.games
    .map((g) => g.startTs)
    .filter((t): t is string => t !== null)
    .sort();
  /* `outsideWeekIds` rather than a near-copy of it: HUB-2 asks the same
     question of the hub's positions — which of the viewer's game ids does the
     loaded slate not already cover — and two spellings of one rule is how they
     drift. Picks are empty here; a betting group has none. */
  const otherIds = outsideWeekIds([], sheet.raw, onSlate);
  let otherGames: typeof slate.games = [];
  if (otherIds.length > 0 && kickoffs.length > 0) {
    /* One narrow read to place them, then one loader call for the ones that
       land inside this week. A bet on a game three weeks ago is a real bet and
       belongs on the ledger; it does not belong on this week's sheet. */
    const { data: placed } = await supabase
      .from("games")
      .select("id")
      .in("id", otherIds)
      .eq("season_id", seasonId)
      .gte("start_ts", kickoffs[0])
      .lte("start_ts", kickoffs[kickoffs.length - 1]);
    const ids = ((placed ?? []) as Array<{ id: number }>).map((g) => g.id);
    if (ids.length > 0) {
      /* WEEK_NONE: these games have no week of their own worth naming here,
         and the ids are the whole query. */
      const extra = await fetchSlateView(
        supabase,
        seasonId,
        WEEK_NONE,
        userId,
        "regular",
        null,
        group.id,
        ids,
      );
      otherGames = extra.games;
    }
  }

  /* 0083. Whose ledger the form below writes to. Normally nobody's but your
     own; an admin can stand in for any other member of this group — a real
     account that texts its bets in, or a seat — via `?for=`. Resolved against
     the roster so a stale or hostile id in the URL means "yourself", the way
     the pick'em board treats a seat id. The write itself is re-checked
     against the database's grant in the action; this only decides what to
     draw. */
  const isAdmin = group.role === "admin" && userId !== null;
  const others = isAdmin ? sheet.members.filter((m) => m.userId !== userId) : [];
  const actingFor = forParam ? (others.find((m) => m.userId === forParam) ?? null) : null;
  const formOptions = actingFor ? await fetchBetFormOptions(supabase, seasonId, DEFAULT_TZ) : null;
  /* Their open bets, newest first, so a number typed wrong from a text can be
     voided by the person who typed it without leaving the page. Graded and
     voided rows are the ledger's business, not this form's. */
  const theirOpen = actingFor
    ? sheet.raw
        .filter((b) => b.user_id === actingFor.userId && b.result === null && b.voided_at === null)
        .sort((a, b) => b.placed_at.localeCompare(a.placed_at))
    : [];

  const onTheSheet = [...slate.games, ...otherGames]
    .filter((g) => g.groupBets.length > 0)
    .sort((a, b) => (a.startTs ?? "9999").localeCompare(b.startTs ?? "9999"));
  /* GRP-13: the season section follows the tab too. Ranked on the league in
     view, and the viewer's tail/fade record cut to it — "how tailing Jeff goes
     in the NFL" was a number the whole-book pair was averaging away. The
     whole book is still one tap away on every card's caption and page. */
  const standings = [...sheet.members].sort(byUnitsIn(league));
  const pairs = userId ? pairStatsFor(betsInLeague(sheet.bets, league), userId) : [];
  const joinCode = (joinRes.data as { join_code: string } | null)?.join_code ?? null;
  // The image share is the viewer's OWN bets, not the whole sheet — a card
  // titled "<display_name> Bets" carrying someone else's picks would be a lie,
  // and the text share already covers the whole-sheet case.
  const weekGameIds = [...slate.games, ...otherGames].map((g) => g.id);
  const { data: myBetRows } =
    userId && weekGameIds.length > 0
      ? await supabase
          .from("bets")
          .select("*")
          .eq("user_id", userId)
          .in("game_id", weekGameIds)
      : { data: [] };
  const myOpen = shareableBets((myBetRows ?? []) as BetRow[]);
  const cardGameById = new Map<number, BetCardGame>(
    [...slate.games, ...otherGames].map((g) => [
      g.id,
      {
        startTs: g.startTs,
        away: { abbr: g.away.abbr, logo: g.away.logo, color: g.away.color },
        home: { abbr: g.home.abbr, logo: g.home.logo, color: g.home.color },
      },
    ]),
  );
  const myCard =
    myOpen.length > 0
      ? betsCardPayload(myOpen, cardGameById, {
          displayName: sheet.nameById.get(userId ?? "") ?? "",
          week,
          day: new Intl.DateTimeFormat("en-US", {
            timeZone: DEFAULT_TZ,
            weekday: "short",
            month: "short",
            day: "numeric",
          }).format(new Date()),
        })
      : null;

  /* WEEK-1: the group's season, week by week, both leagues on every row.
     `sheet.raw` is already every member's bets for the season (both leagues,
     0042); what it does not carry is a week, because a bet has none — its game
     does. One read of those games places every row, and the weekend buckets
     they fall into are the only ones that can hold a CFB Saturday and an NFL
     Sunday on the same line (GRP-12's lesson, `lib/week-records.ts`). */
  const bookGameIds = [
    ...new Set(sheet.raw.map((b) => b.game_id).filter((id): id is number => id !== null)),
  ];
  /* The score comes back with the week (WEEK-3): a group reading this at 4pm on
     a Saturday wants the standings as the board has them, not as the grader
     left them on Tuesday, and the same read covers the Sunday-morning case
     where every game is over and nothing has settled yet. */
  const { data: bookGames } =
    bookGameIds.length > 0
      ? await supabase
          .from("games")
          .select("id, week, season_type, start_ts, status, home_points, away_points")
          .in("id", bookGameIds)
      : { data: [] };
  const bookGameById = new Map(
    ((bookGames ?? []) as Array<{
      id: number;
      week: number;
      season_type: string;
      start_ts: string | null;
      status: string;
      home_points: number | null;
      away_points: number | null;
    }>).map((g) => [g.id, g]),
  );
  /* Voids first (League Rule #4: a void never happened), then the game's week
     and kickoff onto each row. Central, not the reader's zone: a group's week
     has to read the same for everyone in it, or two members would disagree
     about which day a late kickoff was on. */
  type GroupWagerRow = WeekWager & { userId: string };
  const groupWagers: GroupWagerRow[] = sheet.raw
    .filter((b) => b.voided_at === null)
    .map((b) => {
      const g = b.game_id === null ? undefined : bookGameById.get(b.game_id);
      return {
        userId: b.user_id,
        seasonId: b.season_id,
        startTs: g?.start_ts ?? null,
        week: g?.week ?? null,
        seasonType: g?.season_type ?? null,
        result: b.result,
        units: Number(b.units),
        payoutUnits: b.payout_units,
        clv: b.clv,
        odds: b.odds,
        ...standingOf(
          {
            betType: b.bet_type,
            side: b.side,
            line: b.line_taken === null ? null : Number(b.line_taken),
          },
          g,
        ),
      };
    });
  const groupWeeks: GroupWeekRow[] = weekBuckets(groupWagers, DEFAULT_TZ).map((wk) => ({
    key: wk.key,
    label: wk.label,
    range: wk.range,
    record: sliceRecord(wk.wagers),
    members: memberRecords(wk.wagers, sheet.nameById),
    days: wk.days.map((d) => ({
      key: d.key,
      label: d.label,
      record: sliceRecord(d.wagers),
      members: memberRecords(d.wagers, sheet.nameById),
    })),
  }));
  const groupUndated = undatedCount(groupWagers);
  /* Same cadence as the hub: the standings above move with the board, so the
     page has to re-ask for itself while the group has money on a live game. */
  const tier = refreshTier(groupWagers, new Date().getTime());

  const share = userId
    ? buildSheetShareContext({
        groupName: group.name,
        userName: sheet.nameById.get(userId) ?? "Me",
        week,
        games: onTheSheet,
        slug: group.slug,
      })
    : null;

  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <LiveRefresh live={tier.live} imminent={tier.imminent} />
      <GroupSwitcher groups={mine} activeSlug={group.slug} />

      <div className="mt-3 mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">{group.name}</h1>
        <p className="stat flex items-center gap-1.5 text-xs text-chalk/50">
          <Users size={12} aria-hidden />
          <a href="#members" className="hover:text-chalk hover:underline">
            {sheet.members.length} {sheet.members.length === 1 ? "bettor" : "bettors"}
          </a>
          {group.visibility === "public" ? " · public" : " · members only"}
        </p>
      </div>
      <p className="mb-4 flex items-center gap-1.5 text-sm text-dim">
        <Ticket size={13} aria-hidden className="shrink-0 text-accent" />
        Betting group — every bet you log from the slate lands here. First one on a game gets
        credit; everyone after is tailing or fading them.
      </p>

      {/* GRP-12: one sheet per league per week. The switch keeps `?for=` so an
          admin working down a text thread of NFL bets is not sent back to
          their own ledger by changing tab. */}
      <LeagueTabs
        base={`/groups/${group.slug}`}
        league={league}
        leagues={group.leagues}
        extra={{ for: actingFor?.userId ?? null }}
      />

      {/* The member switcher (0083): whose ledger the form and the slate link
          below write to. Rendered only for admins of a group with somebody
          else in it, and it says who is selected rather than trusting the
          reader to notice a URL. */}
      {others.length > 0 && (
        <nav aria-label="Logging for" className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="stat text-[11px] uppercase tracking-wider text-chalk/45">
            Logging for
          </span>
          <Link
            href={`/groups/${group.slug}${weekQuery(weekRef, { league: leagueParam })}`}
            aria-current={actingFor === null ? "page" : undefined}
            className={`stat flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold ${
              actingFor === null
                ? "border-accent bg-accent/15 text-accent"
                : "border-chalk/20 text-dim hover:border-chalk/50"
            }`}
          >
            Me
          </Link>
          {others.map((m) => (
            <Link
              key={m.userId}
              href={`/groups/${group.slug}${weekQuery(weekRef, { league: leagueParam, for: m.userId })}`}
              aria-current={actingFor?.userId === m.userId ? "page" : undefined}
              className={`stat flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold ${
                actingFor?.userId === m.userId
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-chalk/20 text-dim hover:border-chalk/50"
              }`}
            >
              {m.name}
            </Link>
          ))}
        </nav>
      )}

      {actingFor && (
        <section className="card mb-6 border-accent/40 bg-accent/10 p-4" aria-labelledby="acting-heading">
          {/* Said loudly, not inferred from a chip: whose ledger this lands on
              is the one fact an admin working down a text thread must never
              lose track of. */}
          <h2 id="acting-heading" className="text-sm text-chalk">
            You&rsquo;re logging bets for <span className="font-semibold">{actingFor.name}</span>
          </h2>
          <p className="mt-1 text-sm text-dim">
            Everything logged here lands on their ledger, marked as logged by you. Tap an odds cell
            on the slate to do it from the sheet, or type it in below.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href={`/slate?g=${encodeURIComponent(group.slug)}&for=${encodeURIComponent(actingFor.userId)}${league === "nfl" ? "&sport=nfl" : ""}`}
              className="stat inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
            >
              <PenLine size={14} aria-hidden />
              Bet the slate as {actingFor.name.split(" ")[0]}
            </Link>
          </div>
          <div className="mt-4">
            <BetForm
              seasonId={seasonId}
              games={formOptions?.games ?? []}
              forUserId={actingFor.userId}
            />
          </div>
          {theirOpen.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-xs uppercase tracking-wider text-chalk/45">
                {actingFor.name.split(" ")[0]}&rsquo;s open bets
              </h3>
              <ul className="divide-y divide-chalk/8">
                {theirOpen.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 py-1 text-sm">
                    <span className="truncate text-chalk">{b.description}</span>
                    <span className="stat shrink-0 text-xs text-chalk/50">
                      {b.units}u · {b.odds > 0 ? `+${b.odds}` : b.odds}
                    </span>
                    <span className="ml-auto shrink-0">
                      <VoidBetButton betId={b.id} forUserId={actingFor.userId} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link
          href={slateHref}
          className="stat inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
        >
          Go bet the {league.toUpperCase()} slate
        </Link>
        <Link
          href="/ledger"
          className="stat inline-flex min-h-11 items-center rounded-lg border border-chalk/20 px-3.5 text-sm text-chalk hover:border-chalk/50"
        >
          My ledger
        </Link>
        <WeekJump
          base={`/groups/${group.slug}`}
          weeks={weeks}
          current={weekRef}
          sport={league}
          league={leagueParam}
        />
        {share && <ShareSheetButton sheet={share} />}
        {myCard && <ShareImageButton payload={myCard} filename="the-slate-bets.png" label="My bets image" />}
        {group.role === "admin" && (
          <Link
            href={`/groups/${group.slug}/settings`}
            className="stat inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-chalk/20 px-3.5 text-sm text-chalk hover:border-chalk/50"
          >
            <Users size={14} aria-hidden />
            Members
          </Link>
        )}
        {joinCode && <JoinCode code={joinCode} />}
      </div>

      {/* ---- this week's sheet ---- */}
      <section className="mb-7" aria-labelledby="sheet-heading">
        <div className="mb-2.5 flex items-baseline gap-2">
          <h2 id="sheet-heading" className="text-sm text-accent">
            {league.toUpperCase()} {weekLabel(weekRef, league)} sheet
          </h2>
          <span className="h-px flex-1 bg-chalk/10" aria-hidden />
          <span className="stat text-[11px] text-dim">
            {onTheSheet.length} {onTheSheet.length === 1 ? "game" : "games"}
          </span>
        </div>
        {onTheSheet.length === 0 ? (
          <div className="card px-6 py-10 text-center">
            <p className="text-sm text-chalk">
              Nothing on the {league.toUpperCase()} sheet yet this week.
            </p>
            <p className="mt-1 text-sm text-dim">
              <Link href={slateHref} className="font-medium text-accent underline-offset-2 hover:underline">
                Open the {league.toUpperCase()} slate
              </Link>{" "}
              and tap an odds cell — whoever logs a game first is the source.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {onTheSheet.map((g) => (
              <SheetGameRow key={g.id} game={g} />
            ))}
          </ul>
        )}
      </section>

      {/* ---- who's running good ---- */}
      <section className="mb-7" aria-labelledby="standings-heading">
        <div className="mb-2.5 flex items-baseline gap-2">
          <h2 id="standings-heading" className="text-sm text-accent">
            {league.toUpperCase()} season
          </h2>
          <span className="h-px flex-1 bg-chalk/10" aria-hidden />
          <span className="stat text-[11px] text-dim">by {league.toUpperCase()} units</span>
        </div>
        <ul className="flex flex-col gap-2">
          {standings.map((m, i) => (
            <SourceCard
              key={m.userId}
              place={i + 1}
              member={m}
              isMe={m.userId === userId}
              slug={group.slug}
              league={league}
              /* GRP-7: the viewer's own record against this member, tap to
                 open. `pairs` is already computed for the pair panel below;
                 handing each row its slice costs nothing new. Signed in but
                 never followed them synthesizes an EMPTY pair rather than
                 null: the row still expands, and "you have never tailed
                 Hayden" is an answer. Null — a plain card — is only for the
                 signed-out visitor, who has no history to show. */
              pair={
                userId
                  ? (pairs.find((pr) => pr.otherId === m.userId) ?? {
                      otherId: m.userId,
                      tailing: EMPTY_TALLY,
                      fading: EMPTY_TALLY,
                    })
                  : null
              }
            />
          ))}
        </ul>
      </section>

      {/* ---- every week of it, both leagues ---- */}
      <GroupWeekRecords
        weeks={groupWeeks}
        slug={group.slug}
        note={[
          `Weeks run Tuesday to Monday in ${tzLabel(DEFAULT_TZ)}, so Thursday night and the Monday nighter that closes the weekend are one week — which is the only way a CFB Saturday and an NFL Sunday share a row. Both leagues, whichever tab the sheet is on.`,
          "Everyone is ranked on the board as it stands: a bet the grader hasn't settled is scored where it sits, at the price they took, so the order moves while the games are on. Each settled record is underneath its live one.",
          groupUndated > 0
            ? `${groupUndated} ${groupUndated === 1 ? "bet" : "bets"} on no game — futures and freeform rows — sit in no week and are left out.`
            : null,
        ]
          .filter((line): line is string => line !== null)
          .join(" ")}
      />

      {/* ---- you, behind everybody else ---- */}
      {pairs.length > 0 && (
        <section aria-labelledby="pairs-heading">
          <div className="mb-2.5 flex items-baseline gap-2">
            <h2 id="pairs-heading" className="text-sm text-accent">
              How you do behind them
            </h2>
            <span className="h-px flex-1 bg-chalk/10" aria-hidden />
            <span className="stat text-[11px] text-dim">{league.toUpperCase()} only</span>
          </div>
          <PairPanel pairs={pairs} nameById={sheet.nameById} />
          <p className="mt-2 text-[11px] leading-relaxed text-dim">
            Only bets you placed after theirs on the same game and market count. Tailing is the
            same side, fading is the other one — and neither number is knowable from anyone&rsquo;s
            own record, because their season includes every bet you never saw in time.
          </p>
        </section>
      )}

      <GroupRoster
        members={sheet.members}
        viewerId={userId}
        slug={group.slug}
        isAdmin={group.role === "admin"}
      />

      {/* Same roster, different game. A betting group's members play the
          daily four too, and this is where they find out who's winning. */}
      <GroupArcade
        supabase={supabase}
        groupId={group.id}
        groupName={group.name}
        slug={group.slug}
        userId={userId}
      />
    </main>
  );
}

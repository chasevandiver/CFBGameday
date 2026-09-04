import { PenLine, Ticket, Users } from "lucide-react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BetForm } from "../../../components/BetForm";
import { VoidBetButton } from "../../../components/VoidBetButton";
import { GroupArcade } from "../../../components/games/GroupArcade";
import { GroupSwitcher, JoinCode } from "../../../components/group/GroupForms";
import { GroupRoster } from "../../../components/group/GroupRoster";
import {
  PairPanel,
  SheetGameRow,
  SourceCard,
} from "../../../components/group/BettingHub";
import { ShareImageButton } from "../../../components/ShareImageButton";
import { ShareSheetButton } from "../../../components/group/ShareSheetButton";
import { WeekJump } from "../../../components/group/WeekJump";
import { fetchBetFormOptions } from "../../../lib/bet-form-games";
import { byUnits, fetchBettingSheet } from "../../../lib/betting-groups";
import { outsideWeekIds } from "../../../lib/home";
import { weekLabel, weekQuery, type WeekRef } from "../../../lib/group-weeks";
import { EMPTY_TALLY } from "../../../lib/records";
import type { GroupSummary } from "../../../lib/groups";
import type { BetRow } from "../../../lib/db-types";
import { buildSheetShareContext } from "../../../lib/group-share";
import { DEFAULT_TZ } from "../../../lib/kick";
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
 * The last of those is the point. Everyone in a group chat claims a record;
 * "how does tailing you actually go" is a different number, and it is the one
 * nobody can argue with.
 */
export async function BettingHome({
  supabase,
  group,
  mine,
  userId,
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

  /* GRP-6. The sheet was one `fetchSlateView` — one league, one week — so every
     NFL bet a member logged was invisible here, while the standings two
     sections down printed "CFB 8-9 · NFL 3-1" off the same book. `sheet` has
     always read both leagues (0042); only the display forgot.
     Scoped by the selected week's own dates rather than by the NFL calendar,
     because the two leagues do not share week numbers and "week 0" is a CFB
     idea. What belongs on this sheet is what the group had money on while this
     week was being played. */
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
      .select("id, season_id")
      .in("id", otherIds)
      .gte("start_ts", kickoffs[0])
      .lte("start_ts", kickoffs[kickoffs.length - 1]);
    const bySeason = new Map<number, number[]>();
    for (const g of (placed ?? []) as Array<{ id: number; season_id: number }>) {
      bySeason.set(g.season_id, [...(bySeason.get(g.season_id) ?? []), g.id]);
    }
    const loaded = await Promise.all(
      [...bySeason].map(([sid, ids]) =>
        /* WEEK_NONE: these games have no week of their own worth naming here,
           and the ids are the whole query. */
        fetchSlateView(supabase, sid, WEEK_NONE, userId, "regular", null, group.id, ids),
      ),
    );
    otherGames = loaded.flatMap((s) => s.games);
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
  const standings = [...sheet.members].sort(byUnits);
  const pairs = userId ? pairStatsFor(sheet.bets, userId) : [];
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
            href={`/groups/${group.slug}${weekQuery(weekRef)}`}
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
              href={`/groups/${group.slug}${weekQuery(weekRef, { for: m.userId })}`}
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
              href={`/slate?g=${encodeURIComponent(group.slug)}&for=${encodeURIComponent(actingFor.userId)}`}
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
          href="/slate"
          className="stat inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
        >
          Go bet the slate
        </Link>
        <Link
          href="/ledger"
          className="stat inline-flex min-h-11 items-center rounded-lg border border-chalk/20 px-3.5 text-sm text-chalk hover:border-chalk/50"
        >
          My ledger
        </Link>
        <WeekJump base={`/groups/${group.slug}`} weeks={weeks} current={weekRef} sport="cfb" />
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
            {weekLabel(weekRef, "cfb")} sheet
          </h2>
          <span className="h-px flex-1 bg-chalk/10" aria-hidden />
          <span className="stat text-[11px] text-dim">
            {onTheSheet.length} {onTheSheet.length === 1 ? "game" : "games"}
          </span>
        </div>
        {onTheSheet.length === 0 ? (
          <div className="card px-6 py-10 text-center">
            <p className="text-sm text-chalk">Nothing on the sheet yet this week.</p>
            <p className="mt-1 text-sm text-dim">
              <Link href="/slate" className="font-medium text-accent underline-offset-2 hover:underline">
                Open the slate
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
            Season
          </h2>
          <span className="h-px flex-1 bg-chalk/10" aria-hidden />
          <span className="stat text-[11px] text-dim">by units</span>
        </div>
        <ul className="flex flex-col gap-2">
          {standings.map((m, i) => (
            <SourceCard
              key={m.userId}
              place={i + 1}
              member={m}
              isMe={m.userId === userId}
              slug={group.slug}
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

      {/* ---- you, behind everybody else ---- */}
      {pairs.length > 0 && (
        <section aria-labelledby="pairs-heading">
          <div className="mb-2.5 flex items-baseline gap-2">
            <h2 id="pairs-heading" className="text-sm text-accent">
              How you do behind them
            </h2>
            <span className="h-px flex-1 bg-chalk/10" aria-hidden />
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

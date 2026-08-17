import { Ticket, Users } from "lucide-react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GroupArcade } from "../../../components/games/GroupArcade";
import { GroupSwitcher, JoinCode } from "../../../components/group/GroupForms";
import {
  PairPanel,
  SheetGameRow,
  SourceCard,
} from "../../../components/group/BettingHub";
import { ShareImageButton } from "../../../components/ShareImageButton";
import { ShareSheetButton } from "../../../components/group/ShareSheetButton";
import { WeekJump } from "../../../components/group/WeekJump";
import { byUnits, fetchBettingSheet } from "../../../lib/betting-groups";
import { weekLabel, type WeekRef } from "../../../lib/group-weeks";
import type { GroupSummary } from "../../../lib/groups";
import type { BetRow } from "../../../lib/db-types";
import { buildSheetShareContext } from "../../../lib/group-share";
import { DEFAULT_TZ } from "../../../lib/kick";
import {
  betsCardPayload,
  shareableBets,
  type BetCardGame,
} from "../../../lib/share-card-build";
import { fetchSlateView } from "../../../lib/queries";
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

  const onTheSheet = slate.games
    .filter((g) => g.groupBets.length > 0)
    .sort((a, b) => (a.startTs ?? "9999").localeCompare(b.startTs ?? "9999"));
  const standings = [...sheet.members].sort(byUnits);
  const pairs = userId ? pairStatsFor(sheet.bets, userId) : [];
  const joinCode = (joinRes.data as { join_code: string } | null)?.join_code ?? null;
  // The image share is the viewer's OWN bets, not the whole sheet — a card
  // titled "<display_name> Bets" carrying someone else's picks would be a lie,
  // and the text share already covers the whole-sheet case.
  const weekGameIds = slate.games.map((g) => g.id);
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
    slate.games.map((g) => [
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
          {sheet.members.length} {sheet.members.length === 1 ? "bettor" : "bettors"}
          {group.visibility === "public" ? " · public" : " · members only"}
        </p>
      </div>
      <p className="mb-4 flex items-center gap-1.5 text-sm text-dim">
        <Ticket size={13} aria-hidden className="shrink-0 text-accent" />
        Betting group — every bet you log from the slate lands here. First one on a game gets
        credit; everyone after is tailing or fading them.
      </p>

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
            <SourceCard key={m.userId} place={i + 1} member={m} isMe={m.userId === userId} />
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

import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { PicksTab } from "./PicksTab";
import { BetForm, type BetFormGame } from "../../components/BetForm";
import { LiveStatusChip } from "../../components/slate/chips";
import { ShareButton } from "../../components/ShareButton";
import { DeleteWagerButton } from "../../components/DeleteWagerButton";
import { RetagBetButton } from "../../components/RetagBetButton";
import { ShareImageButton } from "../../components/ShareImageButton";
import { StatTile } from "../../components/StatTile";
import { UnitsCurve } from "../../components/UnitsCurve";
import { VoidBetButton } from "../../components/VoidBetButton";
import { REASON_TAGS, REASON_TAG_LABELS, type BetRow, type TeamRow } from "../../lib/db-types";
import { kickParts, tzLabel, DEFAULT_TZ } from "../../lib/kick";
import { statusForBet, type LiveBetStatus } from "../../lib/live-status";
import { betsCardPayload, shareableBets, type BetCardGame } from "../../lib/share-card-build";
import { seasonIdsForYear, seasonYearOf, sportOfSeasonId } from "../../lib/league";
import { fetchBetFormGames, fetchCurrentSeasonWeek } from "../../lib/queries";
import { cumulativeUnits, formatRecord, tally, tallyBy } from "../../lib/records";
import { fmtSpread, fmtTotal, lineForSide } from "../../lib/slate";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ledger" };

/**
 * Spread-style lines get their sign ("-3.5"/"PK"); totals render bare.
 * `line_taken` is stored home-perspective; the ledger shows the number the
 * bettor's ticket actually reads, so away sides convert through `lineForSide`.
 */
function fmtBetLine(b: BetRow): string {
  if (b.line_taken === null) return "–";
  const n = Number(b.line_taken);
  if (b.bet_type === "total" || b.bet_type === "team_total") return fmtTotal(n);
  return fmtSpread(b.side ? lineForSide(b.side, n) : n);
}

const abbrOf = (t: TeamRow | undefined): string =>
  t?.abbreviation ?? t?.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() ?? "?";

type LedgerTab = "bets" | "picks";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId, week } = await fetchCurrentSeasonWeek(supabase);
  const { tab: tabParam } = await searchParams;
  const tab: LedgerTab = tabParam === "picks" ? "picks" : "bets";

  // The picks tab is a different product with different arithmetic, so it
  // loads its own data rather than sharing the bet queries below.
  if (tab === "picks") {
    return (
      <>
        <AppNav />
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
          <h1 className="mb-4 text-2xl">Ledger</h1>
          <LedgerTabs active="picks" />
          {user ? (
            <PicksTab supabase={supabase} seasonId={seasonId} userId={user.id} />
          ) : (
            <section className="card px-6 py-10 text-center text-sm text-dim">
              Sign in to see your pool picks.
            </section>
          )}
        </main>
      </>
    );
  }

  // ADM-1: whether the delete control renders. Not a security boundary — the
  // action re-checks `is_admin` on the server before it touches anything, and
  // the read here only decides what to draw. Same single-row lookup
  // `admin/page.tsx:36-46` uses.
  // Signed-out readers reach this branch with an empty bet list (below), so the
  // lookup is skipped rather than run against a null id.
  const { data: me } = user
    ? await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle()
    : { data: null };
  const isAdmin = me?.is_admin === true;

  // No user → no ledger, without leaning on a "" uuid cast that only returns
  // empty because the cast error is swallowed (audit 06/SEC-09).
  const [{ data }, { data: weekGames }] = await Promise.all([
    user
      ? supabase
          .from("bets")
          .select("*")
          // one book, both leagues — the season id encodes which (0042)
          .in("season_id", seasonIdsForYear(seasonYearOf(seasonId)))
          .eq("user_id", user.id)
          .order("placed_at", { ascending: false })
      : Promise.resolve({ data: [] as BetRow[] }),
    fetchBetFormGames(supabase, seasonId),
  ]);
  const bets = (data ?? []) as BetRow[];

  // this week's games for the bet form, so bets link to a game for grading
  const gameRows = (weekGames ?? []) as Array<{
    id: number;
    start_ts: string | null;
    home_team_id: number;
    away_team_id: number;
  }>;
  const formTeamIds = [...new Set(gameRows.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: formTeams } =
    formTeamIds.length > 0
      ? await supabase.from("teams").select("*").in("id", formTeamIds)
      : { data: [] };
  const teamById = new Map<number, TeamRow>(((formTeams ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const formGames: BetFormGame[] = gameRows.map((g) => {
    const homeAbbr = abbrOf(teamById.get(g.home_team_id));
    const awayAbbr = abbrOf(teamById.get(g.away_team_id));
    const kick = g.start_ts ? kickParts(g.start_ts, DEFAULT_TZ) : null;
    return {
      id: g.id,
      label: `${awayAbbr} @ ${homeAbbr}${kick ? ` · ${kick.day} ${kick.time} ${tzLabel(DEFAULT_TZ)}` : ""}`,
      homeAbbr,
      awayAbbr,
    };
  });

  // live status for open bets tied to an in-progress game (snapshot at page load)
  const openGameIds = [
    ...new Set(
      bets
        .filter((b) => !b.result && !b.voided_at && b.game_id !== null)
        .map((b) => b.game_id as number),
    ),
  ];
  const { data: openGames } =
    openGameIds.length > 0
      ? await supabase
          .from("games")
          // start_ts and both team ids are for the share card: it sorts on
          // kickoff inside a tier and draws each side's crest.
          .select("id, status, home_points, away_points, start_ts, home_team_id, away_team_id")
          .in("id", openGameIds)
      : { data: [] };
  type OpenGame = {
    id: number;
    status: string;
    home_points: number | null;
    away_points: number | null;
    start_ts: string | null;
    home_team_id: number;
    away_team_id: number;
  };
  const openGameRows = (openGames ?? []) as OpenGame[];
  const liveGameById = new Map(
    openGameRows
      .filter((g) => g.status === "in_progress")
      .map((g) => [g.id, g]),
  );

  // Teams for the share card. The bet-form fetch above only covers this week's
  // games, and an open bet can sit on any of them — a future included.
  const cardTeamIds = [
    ...new Set(openGameRows.flatMap((g) => [g.home_team_id, g.away_team_id])),
  ].filter((id) => !teamById.has(id));
  const { data: cardTeams } =
    cardTeamIds.length > 0
      ? await supabase.from("teams").select("*").in("id", cardTeamIds)
      : { data: [] };
  for (const t of (cardTeams ?? []) as TeamRow[]) teamById.set(t.id, t);
  const side = (id: number) => {
    const t = teamById.get(id);
    return t ? { abbr: abbrOf(t), logo: t.logo_url, color: t.color } : null;
  };
  // 0045 freezes the tier at kickoff. This is the page's read of that rule,
  // used only to decide whether to render the picker — the database decides
  // for real, and RetagBetButton surfaces its refusal if the two disagree.
  const kickedOff = new Map(openGameRows.map((g) => [g.id, g.start_ts !== null && g.start_ts <= new Date().toISOString()]));
  const retaggable = (b: BetRow): boolean =>
    b.result === null && b.voided_at === null && !(b.game_id !== null && kickedOff.get(b.game_id));

  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date());

  // The card is titled "<display_name> Bets"; the text share keeps its own
  // "My bets" wording, which reads fine in a message and badly on a poster.
  const { data: profile } = user
    ? await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle()
    : { data: null };
  const displayName: string = profile?.display_name ?? "";

  const cardGameById = new Map<number, BetCardGame>(
    openGameRows.map((g) => [
      g.id,
      { startTs: g.start_ts, away: side(g.away_team_id), home: side(g.home_team_id) },
    ]),
  );
  const liveStatusFor = (b: BetRow): LiveBetStatus | null => {
    if (b.result || b.voided_at || b.game_id === null) return null;
    const g = liveGameById.get(b.game_id);
    if (!g) return null;
    return statusForBet(
      {
        id: b.id,
        betType: b.bet_type,
        side: b.side,
        line: b.line_taken === null ? null : Number(b.line_taken),
      },
      g.home_points ?? 0,
      g.away_points ?? 0,
    );
  };

  // Bets grade at their real American odds, so `payout_units` is passed through
  // rather than synthesized — the one place the shared tally does not apply the
  // flat -110 of pick'em. Moneylines DO grade now (jobs-core handles any
  // American price); what the auto-grader still can't settle from a final
  // score is team_total, first_half and future — those stay open until a
  // manual result is entered, which is by design, not a bug to paper over.
  const graded = bets
    .filter((b) => b.result && b.result !== "void")
    .map((b) => ({ ...b, payoutUnits: b.payout_units }));
  const overall = tally(graded);
  const { units, avgClv } = overall;

  // Who's doing better where: the combined book stays the headline, and the
  // per-league split only appears once there are graded bets in BOTH leagues —
  // an all-CFB ledger looks exactly like it did before the NFL existed.
  const byLeague = tallyBy(graded, (b) => sportOfSeasonId(b.season_id));
  const cfbSplit = byLeague.get("cfb");
  const nflSplit = byLeague.get("nfl");
  const showSplit = cfbSplit !== undefined && nflSplit !== undefined;

  // Reason-tag audit (spec §5.3): W-L, units, ROI, CLV by tag — most bettors
  // have one profitable angle and four leaks. The ledger's marquee feature.
  const byTag = tallyBy(graded, (b) => b.reason_tag);
  const tagRows = REASON_TAGS.filter((tag) => byTag.has(tag))
    .map((tag) => ({ tag, ...byTag.get(tag)! }))
    .sort((a, b) => b.units - a.units);

  // cumulative units, oldest → newest, for the season curve
  const curve = cumulativeUnits(
    [...graded]
      .sort((a, b) => a.placed_at.localeCompare(b.placed_at))
      .map((b) => ({ result: b.result, units: Number(b.units), payoutUnits: b.payout_units })),
  );

  // Share, sourced from bets rather than picks: same formatter, same four
  // modes, different ledger. Today's bets are the ones placed today — a bet
  // has a placed_at of its own, unlike a pick, which is tied to a kickoff.
  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ }).format(new Date(iso));
  const todayKey = dayKey(new Date().toISOString());
  const todayBets = bets.filter((b) => dayKey(b.placed_at) === todayKey);
  const gradedToday = todayBets
    .filter((b) => b.result && b.result !== "void")
    .map((b) => ({ ...b, payoutUnits: b.payout_units }));

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl">Ledger</h1>
          {user && (
            <ShareButton
              context={{
                groupName: "Ledger",
                userName: "My bets",
                week,
                day: dayLabel,
                today: todayBets.map((b) => ({
                  key: String(b.id),
                  market: "spread" as const,
                  side: b.side ?? "home",
                  line: null,
                  homeAbbr: "",
                  awayAbbr: "",
                  // A bet's description is what the bettor typed; there is no
                  // honest way to rebuild a team and a number from it.
                  text: `${b.description}${b.units === 1 ? "" : ` (${b.units}u)`}`,
                })),
                dayRecord: tally(gradedToday),
                weekRecord: overall,
                lifetimeRecord: overall,
              }}
            />
          )}
          {/* The second share option: the same open bets as a card. Text stays
              exactly as it was — this is added beside it, not in place of it. */}
          {user && (
            <ShareImageButton
              payload={
                shareableBets(bets).length > 0
                  ? betsCardPayload(shareableBets(bets), cardGameById, {
                      displayName,
                      week,
                      day: dayLabel,
                    })
                  : null
              }
              filename="cfb-slate-bets.png"
            />
          )}
          {user && (
            <a
              href="/ledger/export"
              className="stat rounded-lg border border-chalk/15 px-3 py-1.5 text-xs text-chalk/70 hover:border-chalk/40"
            >
              Export CSV
            </a>
          )}
        </div>

        <LedgerTabs active="bets" />

        {/* Season dashboard */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Record" value={graded.length ? formatRecord(overall) : "–"} />
          <StatTile
            label="Units"
            value={graded.length ? `${units >= 0 ? "+" : ""}${units.toFixed(1)}` : "–"}
            tone={units > 0 ? "gold" : units < 0 ? "flag" : undefined}
          />
          <StatTile
            label="ROI"
            value={overall.roi === null ? "–" : `${(overall.roi * 100).toFixed(1)}%`}
          />
          <StatTile
            label="Avg CLV"
            value={avgClv === null ? "–" : `${avgClv > 0 ? "+" : ""}${avgClv.toFixed(2)}`}
            tone={avgClv !== null && avgClv > 0 ? "gold" : undefined}
          />
          {showSplit && (
            <>
              <StatTile
                label="CFB"
                value={`${formatRecord(cfbSplit)} · ${cfbSplit.units >= 0 ? "+" : ""}${cfbSplit.units.toFixed(1)}u`}
                tone={cfbSplit.units > 0 ? "gold" : cfbSplit.units < 0 ? "flag" : undefined}
              />
              <StatTile
                label="NFL"
                value={`${formatRecord(nflSplit)} · ${nflSplit.units >= 0 ? "+" : ""}${nflSplit.units.toFixed(1)}u`}
                tone={nflSplit.units > 0 ? "gold" : nflSplit.units < 0 ? "flag" : undefined}
              />
            </>
          )}
        </section>

        {/* Season curve */}
        {curve.length >= 2 && (
          <section className="card mb-6 p-4">
            <h2 className="mb-2 text-sm text-accent">Season curve</h2>
            <UnitsCurve points={curve} />
            <p className="mt-1.5 text-[10.5px] text-dim">
              Cumulative units, bet by bet, oldest to newest.
            </p>
          </section>
        )}

        {/* Reason-tag audit (spec §5.3) */}
        {tagRows.length > 0 && (
          <section className="card mb-6 overflow-x-auto">
            <h2 className="border-b border-chalk/8 px-4 py-2.5 text-sm text-accent">
              Where your edge actually is
            </h2>
            <table className="stats w-full text-sm">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-chalk/55">
                  <th className="py-2 pl-4 pr-3 font-semibold">Tag</th>
                  <th className="px-3 py-2 text-right font-semibold">Record</th>
                  <th className="px-3 py-2 text-right font-semibold">Units</th>
                  <th className="px-3 py-2 text-right font-semibold">ROI</th>
                  <th className="py-2 pl-3 pr-4 text-right font-semibold">CLV</th>
                </tr>
              </thead>
              <tbody>
                {tagRows.map((r) => (
                  <tr key={r.tag} className="border-t border-chalk/5">
                    <td className="py-2 pl-4 pr-3 font-sans text-chalk">
                      {REASON_TAG_LABELS[r.tag]}
                    </td>
                    <td className="px-3 py-2 text-right text-chalk/80">{formatRecord(r)}</td>
                    <td
                      className={`px-3 py-2 text-right ${r.units > 0 ? "text-win" : r.units < 0 ? "text-loss" : ""}`}
                    >
                      {r.units >= 0 ? "+" : ""}
                      {r.units.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right text-chalk/80">
                      {r.roi === null ? "–" : `${(r.roi * 100).toFixed(0)}%`}
                    </td>
                    <td
                      className={`py-2 pl-3 pr-4 text-right ${
                        r.avgClv === null
                          ? ""
                          : r.avgClv > 0
                            ? "text-win"
                            : r.avgClv < 0
                              ? "text-loss"
                              : ""
                      }`}
                    >
                      {r.avgClv === null
                        ? "–"
                        : `${r.avgClv > 0 ? "+" : ""}${r.avgClv.toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2 text-[10.5px] text-dim">
              Positive CLV with a losing record is variance; negative CLV with a winning record
              is luck on a timer. Trust the CLV column.
            </p>
          </section>
        )}

        {/* Entry */}
        <section className="card mb-8 p-4">
          <h2 className="mb-3 text-sm text-accent">Log a bet</h2>
          <BetForm seasonId={seasonId} games={formGames} />
        </section>

        {/* History */}
        <section className="card overflow-x-auto">
          <table className="stats w-full text-sm">
            <thead>
              <tr className="border-b border-chalk/20 text-left text-xs uppercase text-chalk/55">
                <th className="px-3 py-2">Bet</th>
                <th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2">Confidence</th>
                <th className="px-3 py-2 text-right">Line</th>
                <th className="px-3 py-2 text-right">Units</th>
                <th className="px-3 py-2 text-right">CLV</th>
                <th className="px-3 py-2 text-right">Result</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {bets.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-chalk/50">
                    No bets logged yet this season.
                  </td>
                </tr>
              )}
              {bets.map((b) => (
                <tr
                  key={b.id}
                  className={`border-b border-chalk/5 last:border-0 ${b.voided_at ? "opacity-40" : ""}`}
                >
                  <td className="max-w-[16rem] truncate px-3 py-2 font-sans">{b.description}</td>
                  <td className="px-3 py-2 text-xs text-chalk/60">
                    {REASON_TAG_LABELS[b.reason_tag as keyof typeof REASON_TAG_LABELS] ?? b.reason_tag}
                  </td>
                  <td className="px-3 py-2">
                    <RetagBetButton
                      betId={b.id}
                      tier={b.confidence}
                      editable={retaggable(b)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">{fmtBetLine(b)}</td>
                  <td className="px-3 py-2 text-right">{b.units}</td>
                  <td
                    className={`px-3 py-2 text-right ${
                      b.clv === null ? "" : b.clv > 0 ? "text-win" : b.clv < 0 ? "text-loss" : ""
                    }`}
                  >
                    {b.clv === null ? "–" : `${b.clv > 0 ? "+" : ""}${b.clv}`}
                  </td>
                  <td className="px-3 py-2 text-right uppercase">
                    {b.result ??
                      (() => {
                        const status = liveStatusFor(b);
                        return status ? (
                          <LiveStatusChip prefix="" status={status} />
                        ) : (
                          <span className="text-chalk/40">open</span>
                        );
                      })()}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {!b.voided_at && !b.result && <VoidBetButton betId={b.id} />}
                    {/* ADM-1. Admin-only, and in every state — a graded or
                        voided test bet is exactly the row that needs removing,
                        which is why this is not gated the way the void is. */}
                    {isAdmin && <DeleteWagerButton kind="bet" id={b.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="mt-3 text-xs text-chalk/50">
          {/* ADM-1 made the old sentence ("never deleted") false. An admin can
              delete, and the honest version says who and says the deletion is
              still recorded — that is what 0046's archive is for. */}
          The ledger is append-only for you — bets can be voided, never deleted. An admin can
          remove one outright, and that removal is itself recorded. It is yours alone, and it
          is only money: pool picks live under{" "}
          <Link href="/ledger?tab=picks" className="text-accent underline-offset-2 hover:underline">
            Group picks
          </Link>
          , because you will pick games you would never bet and bet games nobody put on a board.
        </p>
      </main>
    </>
  );
}

/**
 * Money on the left, pool on the right, and never the two summed.
 *
 * They are separate products with separate arithmetic — a bet has real odds
 * and a real stake, a pick is flat −110 pretend money — so the page splits at
 * the top rather than mixing them into one history and one ROI.
 */
function LedgerTabs({ active }: { active: LedgerTab }) {
  const tabs: Array<{ key: LedgerTab; href: string; label: string; hint: string }> = [
    { key: "bets", href: "/ledger", label: "Bets", hint: "real money, real odds" },
    { key: "picks", href: "/ledger?tab=picks", label: "Group picks", hint: "pool score, flat −110" },
  ];
  return (
    <div className="mb-5 flex gap-2" role="group" aria-label="Ledger view">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`flex min-h-11 flex-1 flex-col justify-center rounded-lg border px-3 py-1.5 transition-colors ${
            t.key === active
              ? "border-accent bg-accent/15 text-accent"
              : "border-chalk/20 text-dim hover:border-chalk/50"
          }`}
        >
          <span className="stat text-sm font-semibold leading-tight">{t.label}</span>
          <span className="text-[10px] leading-tight opacity-70">{t.hint}</span>
        </Link>
      ))}
    </div>
  );
}


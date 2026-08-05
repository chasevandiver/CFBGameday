import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../components/AppNav";
import type { GameRow, TeamRow } from "../../../lib/db-types";
import { DEFAULT_TZ, kickDateLong } from "../../../lib/kick";
import { pickPollRanks, pollShortName } from "../../../lib/rankings";
import { createClient } from "../../../lib/supabase/server";
import {
  DEFAULT_PARAMS,
  priceGame,
  type TeamRating,
} from "../../../model/ratings";

export const dynamic = "force-dynamic";

interface ComponentsRow {
  final_prev_rating: number | null;
  talent_baseline: number | null;
  churn_adjustment: number | null;
  coaching_adjustment: number | null;
  luck_correction: number | null;
  detail: { proxies?: string[] } | null;
}

interface VerdictRow {
  verdict: {
    ceiling?: string;
    floor?: string;
    swing_factor?: string;
    market_note?: string;
  };
  model: string;
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);
  if (!Number.isFinite(teamId)) notFound();

  const supabase = await createClient();
  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("id", teamId)
    .maybeSingle<TeamRow>();
  if (!team) notFound();

  const [ratingsRes, compsRes, hfaRes, gamesRes, verdictRes, pollsRes] = await Promise.all([
    supabase
      .from("ratings")
      .select("team_id, week, overall")
      .eq("season_id", 2026)
      .order("week", { ascending: false }),
    supabase
      .from("preseason_components")
      .select("final_prev_rating, talent_baseline, churn_adjustment, coaching_adjustment, luck_correction, detail")
      .eq("season_id", 2026)
      .eq("team_id", teamId)
      .maybeSingle<ComponentsRow>(),
    supabase.from("team_hfa").select("team_id, blended_hfa"),
    supabase
      .from("games")
      .select("*")
      .eq("season_id", 2026)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .order("start_ts"),
    supabase
      .from("team_verdicts")
      .select("verdict, model")
      .eq("season_id", 2026)
      .eq("team_id", teamId)
      .maybeSingle<VerdictRow>(),
    supabase
      .from("poll_rankings")
      .select("week, poll, team_id, rank")
      .eq("season_id", 2026)
      .eq("season_type", "regular"),
  ]);

  // Latest rating per team + this team's rank
  const latest = new Map<number, number>();
  for (const r of ratingsRes.data ?? []) {
    if (!latest.has(r.team_id)) latest.set(r.team_id, Number(r.overall));
  }
  const rating = latest.get(teamId);
  const rank =
    rating !== undefined
      ? [...latest.values()].filter((v) => v > rating).length + 1
      : null;
  const hfa = new Map<number, number>(
    (hfaRes.data ?? []).map((r: { team_id: number; blended_hfa: number }) => [
      r.team_id,
      Number(r.blended_hfa),
    ]),
  );

  const games = (gamesRes.data ?? []) as GameRow[];
  const oppIds = games.map((g) => (g.home_team_id === teamId ? g.away_team_id : g.home_team_id));
  const { data: oppRows } = await supabase.from("teams").select("*").in("id", oppIds);
  const opponents = new Map(((oppRows ?? []) as TeamRow[]).map((t) => [t.id, t]));

  // Schedule map with win probability per game (current ratings)
  const toRating = (overall: number | undefined): TeamRating => ({
    overall: overall ?? -30,
    offense: (overall ?? -30) / 2,
    defense: (overall ?? -30) / 2,
    tempo: 70,
  });
  const schedule = games.map((g) => {
    const isHome = g.home_team_id === teamId;
    const oppId = isHome ? g.away_team_id : g.home_team_id;
    const price = priceGame(
      {
        home: toRating(latest.get(g.home_team_id)),
        away: toRating(latest.get(g.away_team_id)),
        homeTeamHfa: hfa.get(g.home_team_id) ?? DEFAULT_PARAMS.baseHfa,
        neutralSite: g.neutral_site,
        situationalPoints: 0,
        vegasSpread: null,
      },
      DEFAULT_PARAMS,
    );
    const winProb = isHome ? price.homeWinProb : 1 - price.homeWinProb;
    const played = g.status === "final" && g.home_points !== null && g.away_points !== null;
    const won = played
      ? isHome
        ? (g.home_points as number) > (g.away_points as number)
        : (g.away_points as number) > (g.home_points as number)
      : null;
    return { g, isHome, opp: opponents.get(oppId), winProb, played, won };
  });
  const projectedWins = schedule
    .filter((s) => !s.played)
    .reduce((a, s) => a + s.winProb, 0) + schedule.filter((s) => s.won).length;

  const comp = compsRes.data;
  const verdict = verdictRes.data?.verdict ?? null;

  const { poll, byTeam: pollRanks } = pickPollRanks(
    (pollsRes.data ?? []) as Array<{ week: number; poll: string; team_id: number; rank: number }>,
  );
  const pollRank = pollRanks.get(teamId) ?? null;
  const pollName = pollShortName(poll);

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {/* Header */}
        <section className="card mb-4 flex items-center gap-4 p-4">
          {team.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={team.logo_url} alt="" className="h-14 w-14 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl leading-tight">{team.school}</h1>
            <p className="text-sm text-dim">
              {[
                team.mascot,
                team.conference,
                pollRank !== null && pollName ? `#${pollRank} ${pollName}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="stat text-2xl font-semibold">
              {rating !== undefined ? `${rating > 0 ? "+" : ""}${rating.toFixed(1)}` : "—"}
            </p>
            <p className="stat text-xs text-dim">{rank !== null ? `#${rank} of FBS` : "unrated"}</p>
          </div>
        </section>

        {/* Preseason breakdown */}
        {comp && (
          <section className="card mb-4 p-4">
            <h2 className="mb-3 text-sm text-accent">How the number is built</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Component label="2025 base" value={comp.final_prev_rating} hint="50/50 our replay + final SP+" />
              <Component label="Talent" value={comp.talent_baseline} hint="4-yr recruiting composite, 30% weight" />
              <Component label="Churn" value={comp.churn_adjustment} hint="Returning production + portal" />
              <Component label="Coaching" value={comp.coaching_adjustment} hint="Admin adjustments handle changes" />
              <Component label="Luck" value={comp.luck_correction} hint="2025 record vs second-order wins" />
            </div>
            {comp.detail?.proxies && (
              <p className="mt-3 text-xs text-dim">
                Honesty notes: {comp.detail.proxies.join(" · ")}
              </p>
            )}
          </section>
        )}

        {/* Verdict (LLM) */}
        {verdict && (
          <section className="card mb-4 p-4">
            <h2 className="mb-3 text-sm text-accent">The Verdict</h2>
            <dl className="flex flex-col gap-2 text-sm">
              {verdict.ceiling && <VerdictLine label="Ceiling" text={verdict.ceiling} />}
              {verdict.floor && <VerdictLine label="Floor" text={verdict.floor} />}
              {verdict.swing_factor && (
                <VerdictLine label="The one thing" text={verdict.swing_factor} />
              )}
              {verdict.market_note && <VerdictLine label="Market note" text={verdict.market_note} />}
            </dl>
          </section>
        )}

        {/* Schedule map */}
        <section className="card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm text-accent">2026 Schedule</h2>
            <p className="stat text-xs text-dim">
              projected {projectedWins.toFixed(1)}–{(schedule.length - projectedWins).toFixed(1)}
            </p>
          </div>
          <ul className="flex flex-col">
            {schedule.map(({ g, isHome, opp, winProb, played, won }) => (
              <li key={g.id} className="border-b border-chalk/5 last:border-0">
                <Link
                  href={`/game/${g.id}`}
                  className="flex items-center gap-3 py-2 hover:bg-elev/50"
                >
                  <span className="stat w-20 shrink-0 text-xs text-dim">
                    {g.start_ts ? kickDateLong(g.start_ts, DEFAULT_TZ) : "TBD"}
                  </span>
                  <span className="w-6 shrink-0 text-xs text-dim">
                    {g.neutral_site ? "vs" : isHome ? "vs" : "at"}
                  </span>
                  {opp?.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={opp.logo_url} alt="" className="h-5 w-5 shrink-0" loading="lazy" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {opp?.school ?? "TBD"}
                    {opp && !latest.has(opp.id) && (
                      <span className="ml-1.5 text-xs text-dim">(FCS)</span>
                    )}
                  </span>
                  {played ? (
                    <span
                      className={`stat shrink-0 text-sm font-semibold ${won ? "text-win" : "text-loss"}`}
                    >
                      {won ? "W" : "L"} {g.home_points}–{g.away_points}
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-2">
                      <WinBar prob={winProb} />
                      <span className="stat w-9 text-right text-xs text-dim">
                        {Math.round(winProb * 100)}%
                      </span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

function Component({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint: string;
}) {
  const v = value !== null ? Number(value) : null;
  return (
    <div className="rounded-lg bg-elev p-2.5" title={hint}>
      <p className="text-[11px] uppercase tracking-wide text-dim">{label}</p>
      <p
        className={`stat mt-0.5 text-lg font-semibold ${
          v === null ? "text-dim" : v > 0 ? "text-win" : v < 0 ? "text-loss" : ""
        }`}
      >
        {v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
      </p>
    </div>
  );
}

function VerdictLine({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-dim">
        {label}
      </dt>
      <dd className="flex-1">{text}</dd>
    </div>
  );
}

function WinBar({ prob }: { prob: number }) {
  return (
    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-elev">
      <span
        className="block h-full rounded-full bg-accent"
        style={{ width: `${Math.round(prob * 100)}%` }}
      />
    </span>
  );
}

import { ArrowLeft, CloudRain, Thermometer, Wind } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../components/AppNav";
import { GameHeader } from "../../../components/game/GameHeader";
import { PickButtons } from "../../../components/PickButtons";
import { ConsensusChip, EdgeChip } from "../../../components/slate/chips";
import { Sparkline } from "../../../components/slate/Sparkline";
import type {
  BetRow,
  GameRow,
  LineSnapshotRow,
  PickRow,
  PredictionRow,
  ProfileRow,
  TeamRow,
} from "../../../lib/db-types";
import { pickPollRanks, pollShortName } from "../../../lib/rankings";
import {
  consensusFromSnapshots,
  consensusHistory,
  fetchTeamAtsSeason,
  type TeamAtsSummary,
} from "../../../lib/queries";
import {
  fmtMoneyline,
  fmtPct,
  fmtSpread,
  fmtTotal,
  stakeForPrediction,
  type MyBetView,
  type TeamView,
} from "../../../lib/slate";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/** Shareable titles: "Georgia @ Alabama · Week 11" instead of the site default. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isFinite(gameId)) return {};
  const supabase = await createClient();
  const { data: game } = await supabase
    .from("games")
    .select("week, season_type, home_team_id, away_team_id")
    .eq("id", gameId)
    .maybeSingle<Pick<GameRow, "week" | "season_type" | "home_team_id" | "away_team_id">>();
  if (!game) return {};
  const { data: teams } = await supabase
    .from("teams")
    .select("id, school")
    .in("id", [game.home_team_id, game.away_team_id]);
  const name = (tid: number) =>
    (teams ?? []).find((t: { id: number; school: string }) => t.id === tid)?.school ?? "TBD";
  const title = `${name(game.away_team_id)} @ ${name(game.home_team_id)}`;
  const description = `${title} — lines, model number, picks, and live status on The CFB Slate.`;
  return {
    title:
      game.season_type === "postseason" ? `${title} · Postseason` : `${title} · Week ${game.week}`,
    description,
    openGraph: { title, description },
  };
}

function toView(t: TeamRow, pollRank: number | null = null, poll: string | null = null): TeamView {
  return {
    id: t.id,
    school: t.school,
    abbr: t.abbreviation ?? t.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase(),
    mascot: t.mascot,
    conference: t.conference,
    color: t.color,
    altColor: t.alt_color,
    logo: t.logo_url,
    rank: null,
    pollRank,
    poll,
    record: null,
  };
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isFinite(gameId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .maybeSingle<GameRow>();
  if (!game) notFound();

  const [teamsRes, linesRes, predRes, picksRes, betsRes, profilesRes, weatherRes, questionsRes, pollsRes] = await Promise.all([
    supabase.from("teams").select("*").in("id", [game.home_team_id, game.away_team_id]),
    supabase.from("line_snapshots").select("*").eq("game_id", gameId),
    supabase
      .from("predictions")
      .select("*")
      .eq("game_id", gameId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("picks").select("*").eq("game_id", gameId),
    user
      ? supabase
          .from("bets")
          .select("id, bet_type, side, line_taken")
          .eq("game_id", gameId)
          .eq("user_id", user.id)
          .is("result", null)
          .is("voided_at", null)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("profiles").select("*"),
    supabase.from("weather_forecasts").select("*").eq("game_id", gameId).maybeSingle(),
    supabase.from("game_questions").select("questions").eq("game_id", gameId).maybeSingle(),
    // whole season, not just these teams: "latest poll week" must come from
    // the full table or a team that dropped out would show a stale rank
    supabase
      .from("poll_rankings")
      .select("week, poll, team_id, rank")
      .eq("season_id", game.season_id)
      .eq("season_type", "regular"),
  ]);

  const teams = new Map(((teamsRes.data ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const homeRow = teams.get(game.home_team_id);
  const awayRow = teams.get(game.away_team_id);
  if (!homeRow || !awayRow) notFound();
  const { poll, byTeam: pollRanks } = pickPollRanks(
    (pollsRes.data ?? []) as Array<{ week: number; poll: string; team_id: number; rank: number }>,
  );
  const pollName = pollShortName(poll);
  const home = toView(homeRow, pollRanks.get(game.home_team_id) ?? null, pollName);
  const away = toView(awayRow, pollRanks.get(game.away_team_id) ?? null, pollName);

  const snapshots = (linesRes.data ?? []) as LineSnapshotRow[];
  const consensus = consensusFromSnapshots(snapshots);
  const history = consensusHistory(snapshots, consensus.open);
  const predictions = (predRes.data ?? []) as PredictionRow[];
  const prediction = predictions.find((p) => p.frozen) ?? predictions[0] ?? null;
  const picks = (picksRes.data ?? []) as PickRow[]; // crew picks are never hidden (0010)
  const profiles = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((p) => [p.id, p]));
  const weather = weatherRes.data as {
    temp_f: number | null;
    wind_mph: number | null;
    precip_prob: number | null;
  } | null;
  const questions =
    (questionsRes.data as { questions: { question: string; why_it_matters: string }[] } | null)
      ?.questions ?? null;

  const trends = await fetchTeamAtsSeason(supabase, game.season_id, [
    game.home_team_id,
    game.away_team_id,
  ]);
  const graded = (t: TeamAtsSummary | undefined) =>
    t !== undefined && t.ats.w + t.ats.l + t.ats.p > 0;
  const showTrends =
    graded(trends.get(game.home_team_id)) || graded(trends.get(game.away_team_id));

  const kickoffPassed = game.start_ts !== null && new Date(game.start_ts) <= new Date();
  const myPick = user ? (picks.find((p) => p.user_id === user.id) ?? null) : null;
  const crewPicks = picks.filter((p) => p.user_id !== user?.id);

  // The live layer (score, situation, win prob, your-action chips) renders in
  // the GameHeader client island, which streams realtime updates and polls as
  // a fallback — this page used to be the only live surface that never moved.
  const openBets = (betsRes.data ?? []) as Array<
    Pick<BetRow, "id" | "bet_type" | "side" | "line_taken">
  >;
  const myBets: MyBetView[] = openBets.map((b) => ({
    id: b.id,
    betType: b.bet_type,
    side: b.side,
    line: b.line_taken === null ? null : Number(b.line_taken),
  }));

  const modelEdge = prediction?.edge === null || prediction === null ? null : Number(prediction.edge);
  const stake = prediction
    ? stakeForPrediction({
        edge: modelEdge,
        edgeFlag: prediction.edge_flag,
        coverProb: prediction.cover_prob === null ? null : Number(prediction.cover_prob),
        vegasSpread: prediction.vegas_spread === null ? null : Number(prediction.vegas_spread),
      })
    : null;
  const stakeTeam = stake?.side === "home" ? home : away;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        <Link
          href="/slate"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-dim transition-colors hover:text-chalk"
        >
          <ArrowLeft size={13} aria-hidden /> Back to slate
        </Link>

        {/* Broadcast header — live island (realtime + poll heal) */}
        <GameHeader
          gameId={game.id}
          week={game.week}
          seasonId={game.season_id}
          neutralSite={game.neutral_site}
          tv={game.tv}
          startTs={game.start_ts}
          home={home}
          away={away}
          prediction={
            prediction
              ? { spread: Number(prediction.spread), homeWinProb: Number(prediction.home_win_prob) }
              : null
          }
          myPick={myPick ? { side: myPick.side, line: Number(myPick.line_at_pick) } : null}
          myBets={myBets}
          initial={{
            status: game.status,
            homePoints: game.home_points,
            awayPoints: game.away_points,
            period: game.current_period,
            clock: game.current_clock,
            situation: game.current_situation,
            lastPlay: game.last_play,
            possession: game.possession,
          }}
        />

        {/* Pick'em + crew — up top, never hidden */}
        <section className="card mt-4 px-4 py-4">
          <h2 className="mb-3 text-sm text-accent">Your pick</h2>
          <PickButtons
            gameId={game.id}
            homeLabel={home.abbr}
            awayLabel={away.abbr}
            currentSpread={consensus.spread}
            myPick={myPick}
            kickoffPassed={kickoffPassed}
            signedIn={user !== null}
          />
          <div className="mt-4 border-t border-chalk/8 pt-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-chalk/40">
              Crew picks
            </p>
            {crewPicks.length === 0 ? (
              <p className="text-sm text-dim">Nobody else has picked this one yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {crewPicks.map((p) => (
                  <li key={p.id} className="stat flex justify-between text-sm">
                    <span>{profiles.get(p.user_id)?.display_name ?? "?"}</span>
                    <span>
                      {p.side === "home" ? home.abbr : away.abbr} {fmtSpread(Number(p.line_at_pick))}
                      {p.result && (
                        <span
                          className={`ml-2 uppercase ${
                            p.result === "win"
                              ? "text-win"
                              : p.result === "loss"
                                ? "text-loss"
                                : "text-push"
                          }`}
                        >
                          {p.result}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Odds table */}
        <section className="card mt-4 overflow-hidden">
          <header className="flex items-center justify-between border-b border-chalk/8 px-4 py-2.5">
            <h2 className="text-sm text-accent">Market</h2>
            <span className="flex items-center gap-2 text-dim">
              {history.length >= 2 && <Sparkline points={history} width={72} height={20} />}
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="stats w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-chalk/40">
                  <th className="py-2 pl-4 pr-3 font-semibold">&nbsp;</th>
                  <th className="py-2 pr-3 font-semibold">Spread</th>
                  <th className="py-2 pr-3 font-semibold">Total</th>
                  <th className="py-2 pr-4 font-semibold">ML</th>
                </tr>
              </thead>
              <tbody>
                <OddsRow
                  label={away.abbr}
                  spread={consensus.spread === null ? null : -consensus.spread}
                  total={consensus.total}
                  totalSide="O"
                  ml={consensus.mlAway}
                />
                <OddsRow
                  label={home.abbr}
                  spread={consensus.spread}
                  total={consensus.total}
                  totalSide="U"
                  ml={consensus.mlHome}
                />
                <tr className="border-t border-chalk/8 text-xs text-dim">
                  <td className="py-2 pl-4 pr-3">Open</td>
                  <td className="py-2 pr-3">
                    {home.abbr} {fmtSpread(consensus.open)}
                  </td>
                  <td className="py-2 pr-3">{fmtTotal(consensus.totalOpen)}</td>
                  <td className="py-2 pr-4">–</td>
                </tr>
                {prediction && (
                  <tr className="border-t border-chalk/8 text-xs">
                    <td className="py-2 pl-4 pr-3 text-accent">Model</td>
                    <td className="py-2 pr-3 text-chalk">
                      {home.abbr} {fmtSpread(Number(prediction.spread))}
                    </td>
                    {/* No model total until real sub-ratings exist (audit #4) */}
                    <td className="py-2 pr-3 text-dim">–</td>
                    <td className="py-2 pr-4 text-chalk">{fmtPct(Number(prediction.home_win_prob))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Model projection */}
        {prediction && (
          <section className="card mt-4 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm text-accent">Model projection</h2>
              <span className="flex gap-1.5">
                <EdgeChip flag={prediction.edge_flag} edge={modelEdge} />
                <ConsensusChip on={prediction.consensus_flag} />
              </span>
            </div>
            <p className="scorebug mt-3 text-center text-3xl text-chalk">
              {home.abbr} {fmtSpread(Number(prediction.spread))}
            </p>
            {/* Model totals / projected scores return once real off/def/tempo
                sub-ratings exist and survive a backtest (audit #4). */}
            <div className="stat mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <ProjStat label="Win prob" value={fmtPct(Number(prediction.home_win_prob))} sub={home.abbr} />
              <ProjStat
                label="Cover prob"
                value={prediction.cover_prob === null ? "–" : fmtPct(Number(prediction.cover_prob))}
                sub={`vs ${fmtSpread(prediction.vegas_spread === null ? null : Number(prediction.vegas_spread))}`}
              />
              <ProjStat
                label="Edge"
                value={modelEdge === null ? "–" : fmtSpread(modelEdge)}
                sub="model − market"
              />
            </div>
            {stake !== null && (
              <p className="stat mt-3 text-center text-sm text-chalk">
                Suggested stake ·{" "}
                <span className="font-semibold text-accent">
                  {stake.units <= 0
                    ? "pass"
                    : `${stake.units}u on ${stakeTeam.abbr} ${fmtSpread(stake.line)}`}
                </span>
                <span className="ml-1.5 text-[10.5px] text-dim">¼ Kelly, 2u cap</span>
              </p>
            )}
          </section>
        )}

        {/* Weather */}
        {weather && (weather.temp_f !== null || weather.wind_mph !== null) && (
          <section className="card mt-4 px-4 py-3.5">
            <h2 className="mb-2 text-sm text-accent">Weather</h2>
            <div className="stat flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-chalk">
              {weather.temp_f !== null && (
                <span className="flex items-center gap-1.5">
                  <Thermometer size={14} aria-hidden className="text-dim" />
                  {Math.round(weather.temp_f)}°F
                </span>
              )}
              {weather.wind_mph !== null && (
                <span className={`flex items-center gap-1.5 ${weather.wind_mph > 15 ? "text-edge" : ""}`}>
                  <Wind size={14} aria-hidden className={weather.wind_mph > 15 ? "" : "text-dim"} />
                  {Math.round(weather.wind_mph)} mph
                  {weather.wind_mph > 15 ? " — totals flag" : ""}
                </span>
              )}
              {weather.precip_prob !== null && (
                <span className="flex items-center gap-1.5">
                  <CloudRain size={14} aria-hidden className="text-dim" />
                  {Math.round(weather.precip_prob)}% precip
                </span>
              )}
            </div>
          </section>
        )}

        {/* ATS trends — fun box only */}
        {showTrends && (
          <section className="card mt-4 px-4 py-3.5">
            <h2 className="mb-2 text-sm text-accent">Trends</h2>
            <div className="flex flex-col gap-1.5">
              <TrendLine team={away} summary={trends.get(game.away_team_id)} />
              <TrendLine team={home} summary={trends.get(game.home_team_id)} />
            </div>
            <p className="mt-2 text-[10.5px] text-dim">
              For fun — trends are never fed to the model.
            </p>
          </section>
        )}

        {/* Three questions (LLM) */}
        {questions && questions.length > 0 && (
          <section className="card mt-4 px-4 py-4">
            <h2 className="mb-3 text-sm text-accent">Three questions</h2>
            <ol className="flex flex-col gap-3">
              {questions.map((q, i) => (
                <li key={i} className="flex gap-3">
                  <span className="stat shrink-0 text-lg font-semibold text-chalk/30">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-chalk">{q.question}</p>
                    <p className="mt-0.5 text-xs text-dim">{q.why_it_matters}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

      </main>
    </>
  );
}

const fmtRec = (r: { w: number; l: number; p: number }) =>
  `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;

function TrendLine({ team, summary }: { team: TeamView; summary: TeamAtsSummary | undefined }) {
  if (!summary || summary.ats.w + summary.ats.l + summary.ats.p === 0) return null;
  const ouTotal = summary.ou.o + summary.ou.u + summary.ou.p;
  return (
    <p className="stat text-sm text-chalk">
      <span className="font-semibold">{team.abbr}</span>{" "}
      <span>{fmtRec(summary.ats)} ATS</span>
      <span className="text-dim">
        {" "}
        ({fmtRec(summary.homeAts)} home, {fmtRec(summary.awayAts)} road)
      </span>
      {ouTotal > 0 && (
        <span>
          {" · "}O/U {summary.ou.o}-{summary.ou.u}
          {summary.ou.p ? `-${summary.ou.p}` : ""}
        </span>
      )}
    </p>
  );
}

function OddsRow({
  label,
  spread,
  total,
  totalSide,
  ml,
}: {
  label: string;
  spread: number | null;
  total: number | null;
  totalSide: "O" | "U";
  ml: number | null;
}) {
  return (
    <tr>
      <td className="py-2 pl-4 pr-3 font-medium text-chalk">{label}</td>
      <td className="py-2 pr-3 text-chalk">{fmtSpread(spread)}</td>
      <td className="py-2 pr-3 text-chalk">
        {total === null ? "–" : `${totalSide} ${fmtTotal(total)}`}
      </td>
      <td className="py-2 pr-4 text-chalk">{fmtMoneyline(ml)}</td>
    </tr>
  );
}

function ProjStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-elev px-2 py-2.5 ring-1 ring-inset ring-chalk/8">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-chalk/40">{label}</p>
      <p className="mt-0.5 text-base font-semibold text-chalk">{value}</p>
      {sub && <p className="text-[10px] text-dim">{sub}</p>}
    </div>
  );
}

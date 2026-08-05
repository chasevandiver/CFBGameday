import { ArrowLeft, CloudRain, Thermometer, Tv, Wind } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../components/AppNav";
import { PickButtons } from "../../../components/PickButtons";
import { ConsensusChip, EdgeChip, LiveBadge } from "../../../components/slate/chips";
import { Sparkline } from "../../../components/slate/Sparkline";
import { TeamMark } from "../../../components/slate/TeamMark";
import { WinProbBar } from "../../../components/slate/WinProbBar";
import type {
  GameRow,
  LineSnapshotRow,
  PickRow,
  PredictionRow,
  ProfileRow,
  TeamRow,
} from "../../../lib/db-types";
import { kickDateLong, kickParts, periodLabel, DEFAULT_TZ } from "../../../lib/kick";
import { consensusFromSnapshots, consensusHistory } from "../../../lib/queries";
import { fmtMoneyline, fmtPct, fmtSpread, fmtTotal, type TeamView } from "../../../lib/slate";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

function toView(t: TeamRow): TeamView {
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

  const [teamsRes, linesRes, predRes, picksRes, profilesRes, weatherRes, questionsRes] = await Promise.all([
    supabase.from("teams").select("*").in("id", [game.home_team_id, game.away_team_id]),
    supabase.from("line_snapshots").select("*").eq("game_id", gameId),
    supabase
      .from("predictions")
      .select("*")
      .eq("game_id", gameId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("picks").select("*").eq("game_id", gameId),
    supabase.from("profiles").select("*"),
    supabase.from("weather_forecasts").select("*").eq("game_id", gameId).maybeSingle(),
    supabase.from("game_questions").select("questions").eq("game_id", gameId).maybeSingle(),
  ]);

  const teams = new Map(((teamsRes.data ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const homeRow = teams.get(game.home_team_id);
  const awayRow = teams.get(game.away_team_id);
  if (!homeRow || !awayRow) notFound();
  const home = toView(homeRow);
  const away = toView(awayRow);

  const snapshots = (linesRes.data ?? []) as LineSnapshotRow[];
  const consensus = consensusFromSnapshots(snapshots);
  const history = consensusHistory(snapshots);
  const predictions = (predRes.data ?? []) as PredictionRow[];
  const prediction = predictions.find((p) => p.frozen) ?? predictions[0] ?? null;
  const picks = (picksRes.data ?? []) as PickRow[]; // RLS: others' picks only post-kickoff
  const profiles = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((p) => [p.id, p]));
  const weather = weatherRes.data as {
    temp_f: number | null;
    wind_mph: number | null;
    precip_prob: number | null;
  } | null;
  const questions =
    (questionsRes.data as { questions: { question: string; why_it_matters: string }[] } | null)
      ?.questions ?? null;

  const kickoffPassed = game.start_ts !== null && new Date(game.start_ts) <= new Date();
  const myPick = user ? (picks.find((p) => p.user_id === user.id) ?? null) : null;
  const crewPicks = picks.filter((p) => p.user_id !== user?.id);

  const live = game.status === "in_progress";
  const final = game.status === "final";
  const showScore = live || final;
  const tz = DEFAULT_TZ;
  const homeColor = home.color ?? "#5b6472";
  const awayColor = away.color ?? "#5b6472";
  const homeLost =
    final && game.home_points !== null && game.away_points !== null && game.home_points < game.away_points;
  const awayLost =
    final && game.home_points !== null && game.away_points !== null && game.away_points < game.home_points;

  const modelEdge = prediction?.edge === null || prediction === null ? null : Number(prediction.edge);

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        <Link
          href="/slate"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-dim transition-colors hover:text-chalk"
        >
          <ArrowLeft size={13} aria-hidden /> Back to slate
        </Link>

        {/* Broadcast header */}
        <section className={`card relative overflow-hidden ${live ? "card-live" : ""}`}>
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.16]"
            style={{
              background: `linear-gradient(105deg, ${awayColor} 0%, ${awayColor} 38%, transparent 50%, ${homeColor} 62%, ${homeColor} 100%)`,
            }}
          />
          <div aria-hidden className="absolute inset-x-0 top-0 flex h-1">
            <span className="flex-1" style={{ background: awayColor }} />
            <span className="flex-1" style={{ background: homeColor }} />
          </div>

          <div className="relative px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-2 text-xs text-dim">
              <span className="stat">
                {live ? (
                  <span className="flex items-center gap-2">
                    <LiveBadge />
                    <span className="font-semibold text-chalk">
                      {periodLabel(game.current_period)}
                      {game.current_clock ? ` · ${game.current_clock}` : ""}
                    </span>
                  </span>
                ) : final ? (
                  <span className="font-semibold uppercase">
                    Final
                    {game.current_period !== null && game.current_period > 4
                      ? ` / ${periodLabel(game.current_period)}`
                      : ""}
                  </span>
                ) : game.start_ts ? (
                  `${kickDateLong(game.start_ts, tz)} · ${kickParts(game.start_ts, tz).time} CT`
                ) : (
                  "Kickoff TBD"
                )}
              </span>
              {game.tv && (
                <span className="stat flex items-center gap-1">
                  <Tv size={12} aria-hidden />
                  {game.tv}
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
              <HeaderTeam team={away} points={game.away_points} showScore={showScore} lost={awayLost} align="left" />
              <span className="scorebug text-lg text-chalk/35">{game.neutral_site ? "vs" : "@"}</span>
              <HeaderTeam team={home} points={game.home_points} showScore={showScore} lost={homeLost} align="right" />
            </div>

            {prediction && (
              <div className="mx-auto mt-4 max-w-md">
                <WinProbBar
                  home={home}
                  away={away}
                  homeWinProb={Number(prediction.home_win_prob)}
                  height={7}
                />
              </div>
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
                    <td className="py-2 pr-3 text-chalk">
                      {prediction.total === null ? "–" : fmtTotal(Number(prediction.total))}
                    </td>
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
            {prediction.home_score !== null && prediction.away_score !== null && (
              <p className="scorebug mt-3 text-center text-3xl text-chalk">
                {home.abbr} {Math.round(Number(prediction.home_score))}
                <span className="mx-2 text-chalk/30">–</span>
                {away.abbr} {Math.round(Number(prediction.away_score))}
              </p>
            )}
            <div className="stat mt-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
              <ProjStat label="Win prob" value={fmtPct(Number(prediction.home_win_prob))} sub={home.abbr} />
              <ProjStat
                label="Cover prob"
                value={prediction.cover_prob === null ? "–" : fmtPct(Number(prediction.cover_prob))}
                sub={`vs ${fmtSpread(prediction.vegas_spread === null ? null : Number(prediction.vegas_spread))}`}
              />
              <ProjStat
                label="Model total"
                value={prediction.total === null ? "–" : fmtTotal(Number(prediction.total))}
                sub={
                  prediction.total !== null && consensus.total !== null
                    ? Number(prediction.total) > consensus.total
                      ? "over lean"
                      : "under lean"
                    : ""
                }
              />
              <ProjStat
                label="Edge"
                value={modelEdge === null ? "–" : fmtSpread(modelEdge)}
                sub="model − market"
              />
            </div>
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

        {/* Pick'em */}
        <section className="card mt-4 px-4 py-4">
          <h2 className="mb-3 text-sm text-accent">Your pick</h2>
          <PickButtons
            gameId={game.id}
            homeLabel={home.abbr}
            awayLabel={away.abbr}
            currentSpread={consensus.spread}
            myPick={myPick}
            kickoffPassed={kickoffPassed}
          />
        </section>

        {/* Crew corner */}
        <section className="card mt-4 px-4 py-4">
          <h2 className="mb-3 text-sm text-accent">Crew picks</h2>
          {!kickoffPassed ? (
            <p className="text-sm text-dim">Hidden until kickoff.</p>
          ) : crewPicks.length === 0 ? (
            <p className="text-sm text-dim">Nobody else picked this one.</p>
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
        </section>
      </main>
    </>
  );
}

function HeaderTeam({
  team,
  points,
  showScore,
  lost,
  align,
}: {
  team: TeamView;
  points: number | null;
  showScore: boolean;
  lost: boolean;
  align: "left" | "right";
}) {
  const right = align === "right";
  return (
    <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""} ${lost ? "opacity-50" : ""}`}>
      <TeamMark team={team} size={48} glow />
      <div className={`min-w-0 ${right ? "text-right" : ""}`}>
        <p className="scorebug truncate text-lg leading-tight text-chalk sm:text-xl">{team.school}</p>
        <p className="stat text-[10.5px] text-dim">{team.conference ?? ""}</p>
        {showScore && (
          <p className={`scorebug text-4xl leading-none ${lost ? "text-dim" : "text-chalk"}`}>
            {points ?? 0}
          </p>
        )}
      </div>
    </div>
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

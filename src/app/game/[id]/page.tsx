import { notFound } from "next/navigation";
import { AppNav } from "../../../components/AppNav";
import { ConsensusBadge, EdgeBadge, fmtPct, fmtSpread } from "../../../components/badges";
import { PickButtons } from "../../../components/PickButtons";
import type {
  GameRow,
  LineSnapshotRow,
  PickRow,
  PredictionRow,
  ProfileRow,
  TeamRow,
} from "../../../lib/db-types";
import { consensusFromSnapshots } from "../../../lib/queries";
import { createClient } from "../../../lib/supabase/server";
import { kickDate, kickDayTime } from "../../../lib/time";

export const dynamic = "force-dynamic";

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

  const [teamsRes, linesRes, predRes, picksRes, profilesRes, weatherRes] = await Promise.all([
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
  ]);

  const teams = new Map(((teamsRes.data ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const home = teams.get(game.home_team_id);
  const away = teams.get(game.away_team_id);
  if (!home || !away) notFound();

  const snapshots = (linesRes.data ?? []) as LineSnapshotRow[];
  const consensus = consensusFromSnapshots(snapshots);
  const predictions = (predRes.data ?? []) as PredictionRow[];
  const prediction = predictions.find((p) => p.frozen) ?? predictions[0] ?? null;
  const picks = (picksRes.data ?? []) as PickRow[]; // RLS: others' picks only post-kickoff
  const profiles = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((p) => [p.id, p]));
  const weather = weatherRes.data as {
    temp_f: number | null;
    wind_mph: number | null;
    precip_prob: number | null;
  } | null;

  const kickoffPassed = game.start_ts !== null && new Date(game.start_ts) <= new Date();
  const myPick = user ? (picks.find((p) => p.user_id === user.id) ?? null) : null;
  const crewPicks = picks.filter((p) => p.user_id !== user?.id);

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {/* Header */}
        <section className="mb-6 rounded border border-chalk/10 bg-surface p-4">
          <div className="mb-1 flex items-center justify-between text-xs text-chalk/60">
            <span className="stat">
              {game.start_ts ? `${kickDate(game.start_ts)} · ${kickDayTime(game.start_ts)} CT` : "TBD"}
            </span>
            <span className="stat">{game.tv ?? ""}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <TeamBlock team={away} points={game.away_points} status={game.status} />
            <span className="text-chalk/40">@</span>
            <TeamBlock team={home} points={game.home_points} status={game.status} right />
          </div>
          {weather && (weather.wind_mph ?? 0) > 0 && (
            <p className="stat mt-2 text-xs text-chalk/60">
              {weather.temp_f !== null ? `${Math.round(weather.temp_f)}°F` : ""}
              {weather.wind_mph !== null ? ` · wind ${Math.round(weather.wind_mph)} mph` : ""}
              {(weather.wind_mph ?? 0) > 15 ? " ⚠ totals" : ""}
              {weather.precip_prob !== null ? ` · ${Math.round(weather.precip_prob)}% precip` : ""}
            </p>
          )}
        </section>

        {/* Numbers row */}
        <section className="mb-6 overflow-x-auto">
          <table className="stats w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-chalk/20 text-left text-xs uppercase text-chalk/50">
                <th className="py-1 pr-3">Model</th>
                <th className="py-1 pr-3">Vegas</th>
                <th className="py-1 pr-3">Open</th>
                <th className="py-1 pr-3">Win %</th>
                <th className="py-1 pr-3">Cover %</th>
                <th className="py-1">Flags</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-2 pr-3">
                  {prediction ? `${home.abbreviation ?? "Home"} ${fmtSpread(prediction.spread)}` : "–"}
                </td>
                <td className="py-2 pr-3">{fmtSpread(consensus.spread)}</td>
                <td className="py-2 pr-3">{fmtSpread(consensus.open)}</td>
                <td className="py-2 pr-3">{fmtPct(prediction?.home_win_prob ?? null)}</td>
                <td className="py-2 pr-3">{fmtPct(prediction?.cover_prob ?? null)}</td>
                <td className="py-2">
                  <span className="flex gap-1">
                    <EdgeBadge flag={prediction?.edge_flag ?? null} />
                    <ConsensusBadge on={prediction?.consensus_flag ?? false} />
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Projected score */}
        {prediction?.home_score !== null && prediction?.away_score !== null && prediction && (
          <section className="mb-6 rounded border border-chalk/10 bg-surface p-4 text-center">
            <p className="text-xs uppercase text-chalk/50">Projected</p>
            <p className="stat mt-1 text-2xl">
              {home.abbreviation ?? home.school} {Math.round(prediction.home_score!)},{" "}
              {away.abbreviation ?? away.school} {Math.round(prediction.away_score!)}
            </p>
            {prediction.total !== null && consensus.total !== null && (
              <p className="stat mt-1 text-xs text-chalk/60">
                model total {Math.round(prediction.total)} vs O/U {consensus.total} →{" "}
                {prediction.total > consensus.total ? "over lean" : "under lean"}
              </p>
            )}
          </section>
        )}

        {/* Pick'em */}
        <section className="mb-6 rounded border border-chalk/10 bg-surface p-4">
          <h2 className="mb-3 text-sm text-gold">Your Pick</h2>
          <PickButtons
            gameId={game.id}
            homeLabel={home.abbreviation ?? home.school}
            awayLabel={away.abbreviation ?? away.school}
            currentSpread={consensus.spread}
            myPick={myPick}
            kickoffPassed={kickoffPassed}
          />
        </section>

        {/* Crew corner */}
        <section className="rounded border border-chalk/10 bg-surface p-4">
          <h2 className="mb-3 text-sm text-gold">Crew Picks</h2>
          {!kickoffPassed ? (
            <p className="text-sm text-chalk/50">Hidden until kickoff.</p>
          ) : crewPicks.length === 0 ? (
            <p className="text-sm text-chalk/50">Nobody else picked this one.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {crewPicks.map((p) => (
                <li key={p.id} className="stat flex justify-between text-sm">
                  <span>{profiles.get(p.user_id)?.display_name ?? "?"}</span>
                  <span>
                    {p.side === "home" ? (home.abbreviation ?? home.school) : (away.abbreviation ?? away.school)}{" "}
                    {fmtSpread(p.line_at_pick)}
                    {p.result && <span className="ml-2 uppercase text-chalk/50">{p.result}</span>}
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

function TeamBlock({
  team,
  points,
  status,
  right = false,
}: {
  team: TeamRow;
  points: number | null;
  status: string;
  right?: boolean;
}) {
  const showScore = status === "in_progress" || status === "final";
  return (
    <div className={`flex-1 ${right ? "text-right" : ""}`}>
      <p className="text-lg font-semibold" style={{ color: team.color ?? undefined }}>
        {team.school}
      </p>
      <p className="text-xs text-chalk/60">{team.conference ?? ""}</p>
      {showScore && <p className="stat mt-1 text-3xl">{points ?? 0}</p>}
    </div>
  );
}

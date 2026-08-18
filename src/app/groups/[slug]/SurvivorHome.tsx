import { Skull, Trophy, Users } from "lucide-react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GroupArcade } from "../../../components/games/GroupArcade";
import { GroupSwitcher, JoinCode } from "../../../components/group/GroupForms";
import { GroupRoster } from "../../../components/group/GroupRoster";
import { SurvivorPicker, type PickableGame } from "../../../components/group/SurvivorPicker";
import { WeekJump } from "../../../components/group/WeekJump";
import { TeamMark } from "../../../components/slate/TeamMark";
import { weekLabel, type WeekRef } from "../../../lib/group-weeks";
import { fetchGroupMembers, type GroupSummary } from "../../../lib/groups";
import { DEFAULT_TZ, kickParts, tzLabel } from "../../../lib/kick";
import {
  blockReason,
  isStrike,
  OUTCOME_WORD,
  poolRulesLine,
  survivorStandings,
  teamsSpentElsewhere,
  type SurvivorEntry,
  type SurvivorPool,
  type SurvivorWeekResult,
} from "../../../lib/survivor";
import {
  fetchSurvivorPicks,
  fetchSurvivorScope,
} from "../../../lib/survivor-data";

/**
 * A survivor pool's home.
 *
 * Three questions, in the order the format asks them: am I still in, what is my
 * pick this week, and who else is left. Standings are recomputed from the whole
 * season's picks on every load — nothing stores "eliminated" (migration 0053).
 */
export async function SurvivorHome({
  supabase,
  group,
  pool,
  mine,
  userId,
  weekRef,
  weeks,
}: {
  supabase: SupabaseClient;
  group: GroupSummary;
  pool: SurvivorPool;
  mine: GroupSummary[];
  userId: string | null;
  weekRef: WeekRef;
  weeks: WeekRef[];
}) {
  const sport = group.leagues.includes("nfl") ? ("nfl" as const) : ("cfb" as const);
  const [members, scope, picks, joinRes] = await Promise.all([
    fetchGroupMembers(supabase, group.id),
    fetchSurvivorScope(supabase, pool),
    fetchSurvivorPicks(supabase, group.id, pool.seasonId),
    group.role === "admin"
      ? supabase.from("groups").select("join_code").eq("id", group.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const standings = survivorStandings(members, picks, scope.games, pool, weekRef);
  const me = userId ? (standings.find((s) => s.userId === userId) ?? null) : null;
  const alive = standings.filter((s) => !s.eliminated);
  const out = standings.filter((s) => s.eliminated);
  const joinCode = (joinRes.data as { join_code: string } | null)?.join_code ?? null;

  // This week's board, in kickoff order.
  const weekGames = scope.games
    .filter((g) => g.week === weekRef.week && g.seasonType === weekRef.seasonType)
    .sort((a, b) => (a.startTs ?? "9999").localeCompare(b.startTs ?? "9999"));

  // Teams spent in OTHER weeks. `usedTeamIds` includes this week's own pick, and
  // passing that in labelled your current pick "already used" — a rule
  // `make_survivor_pick` does not enforce (0053 excludes the week being
  // written).
  const spentElsewhere = me ? teamsSpentElsewhere(me, weekRef) : [];

  const board: PickableGame[] = weekGames.map((g) => {
    const kick = g.startTs ? kickParts(g.startTs, DEFAULT_TZ) : null;
    const side = (teamId: number) => {
      const team = scope.teams.get(teamId)!;
      return {
        team,
        block: blockReason(teamId, team.conference, g, spentElsewhere, pool),
      };
    };
    return {
      gameId: g.id,
      kick: kick ? `${kick.day} ${kick.time} ${tzLabel(DEFAULT_TZ)}` : "TBD",
      // Same clock the RPC keeps: a TBD kickoff counts as locked rather than as
      // open forever.
      locked: g.startTs === null || new Date(g.startTs) <= new Date(),
      away: side(g.awayTeamId),
      home: side(g.homeTeamId),
    };
  });

  return (
    <main
      id="main"
      /* pb-28 clears the picker's fixed bar, the same reservation
         /groups/[slug]/picks makes. Without a bar there is nothing to clear. */
      className={`mx-auto w-full max-w-3xl flex-1 px-4 pt-6 ${
        userId && !(me?.eliminated ?? false) && board.length > 0 ? "pb-28" : "pb-6"
      }`}
    >
      <GroupSwitcher groups={mine} activeSlug={group.slug} />

      <div className="mt-3 mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">{group.name}</h1>
        <p className="stat flex items-center gap-1.5 text-xs text-chalk/50">
          <Users size={12} aria-hidden />
          <a href="#members" className="hover:text-chalk hover:underline">
            {alive.length} of {standings.length} alive
          </a>
          {group.visibility === "public" ? " · public" : " · members only"}
        </p>
      </div>
      <p className="mb-4 flex items-center gap-1.5 text-sm text-dim">
        <Trophy size={13} aria-hidden className="shrink-0 text-accent" />
        Survivor — {poolRulesLine(pool, sport)}. A tie counts against you.
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <WeekJump
          base={`/groups/${group.slug}`}
          weeks={weeks}
          current={weekRef}
          sport={sport}
        />
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

      {/* ---- where you stand ---- */}
      {me && (
        <section
          className="glass-wrap mb-6"
          data-tint="position"
          style={{ "--aura-strength": me.eliminated ? 0.18 : 0.3 } as React.CSSProperties}
          aria-labelledby="my-status"
        >
          <div className="glass-aura" aria-hidden>
            <span
              className="aura-a"
              style={{ background: me.eliminated ? "var(--loss)" : "var(--win)" }}
            />
            <span
              className="aura-b"
              style={{ background: me.eliminated ? "var(--loss)" : "var(--win)" }}
            />
          </div>
          <div className="card relative overflow-hidden p-4">
            <h2 id="my-status" className="sr-only">
              Your standing
            </h2>
            <p className="leading-none">
              <span
                className={`display text-2xl italic uppercase tracking-wide ${
                  me.eliminated ? "text-loss" : "text-win"
                }`}
              >
                {me.eliminated ? "Eliminated" : "Still alive"}
              </span>
              <span className="stat mt-1.5 block text-[11px] text-chalk/55">
                {me.eliminated && me.eliminatedIn
                  ? `Out in ${weekLabel(me.eliminatedIn, sport).toLowerCase()} · ${me.usedTeamIds.length} teams used`
                  : `${me.strikes} of ${pool.strikes} ${pool.strikes === 1 ? "strike" : "strikes"} used · ${me.usedTeamIds.length} teams spent`}
              </span>
            </p>
            {me.usedTeamIds.length > 0 && (
              <p className="mt-3 flex flex-wrap items-center gap-1.5">
                {me.usedTeamIds.map((id, i) => {
                  const t = scope.teams.get(id);
                  return t ? (
                    <span key={`${id}-${i}`} title={t.school}>
                      <TeamMark team={t} size={22} />
                    </span>
                  ) : null;
                })}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ---- this week ---- */}
      <section className="mb-7" aria-labelledby="board-heading">
        <div className="mb-2.5 flex items-baseline gap-2">
          <h2 id="board-heading" className="text-sm text-accent">
            {weekLabel(weekRef, sport)} pick
          </h2>
          <span className="h-px flex-1 bg-chalk/10" aria-hidden />
          <span className="stat text-[11px] text-dim">
            {me?.current?.teamId
              ? (scope.teams.get(me.current.teamId)?.school ?? "picked")
              : "nothing in yet"}
          </span>
        </div>
        {!userId ? (
          <p className="card px-6 py-8 text-center text-sm text-dim">
            <Link href="/login" className="font-medium text-accent underline-offset-2 hover:underline">
              Sign in
            </Link>{" "}
            to take a team.
          </p>
        ) : (
          <SurvivorPicker
            groupId={group.id}
            week={weekRef.week}
            seasonType={weekRef.seasonType}
            games={board}
            currentTeamId={me?.current?.teamId ?? null}
            eliminated={me?.eliminated ?? false}
            reviewHref={me ? "#my-picks" : null}
          />
        )}
      </section>

      {/* ---- your season ---- */}
      {me && (
        <section className="mb-7 scroll-mt-16" id="my-picks" aria-labelledby="my-picks-heading">
          <div className="mb-2.5 flex items-baseline gap-2">
            <h2 id="my-picks-heading" className="text-sm text-accent">
              Your picks
            </h2>
            <span className="h-px flex-1 bg-chalk/10" aria-hidden />
            <span className="stat text-[11px] text-dim">
              {me.usedTeamIds.length} of {me.weeks.length} weeks in
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {me.weeks.map((w) => (
              <PickLogRow
                key={`${w.seasonType}:${w.week}`}
                result={w}
                team={w.teamId === null ? null : (scope.teams.get(w.teamId) ?? null)}
                sport={sport}
                viewing={w.week === weekRef.week && w.seasonType === weekRef.seasonType}
              />
            ))}
            {me.weeks.length === 0 && (
              <li className="card px-6 py-8 text-center text-sm text-dim">
                The pool has no weeks yet.
              </li>
            )}
          </ul>
        </section>
      )}

      {/* ---- who's left ---- */}
      <section aria-labelledby="alive-heading">
        <div className="mb-2.5 flex items-baseline gap-2">
          <h2 id="alive-heading" className="text-sm text-accent">
            Still alive
          </h2>
          <span className="h-px flex-1 bg-chalk/10" aria-hidden />
          <span className="stat text-[11px] text-dim">{alive.length}</span>
        </div>
        <ul className="flex flex-col gap-2">
          {alive.map((e) => (
            <EntryCard
              key={e.userId}
              entry={e}
              isMe={e.userId === userId}
              pool={pool}
              teams={scope.teams}
              sport={sport}
            />
          ))}
          {alive.length === 0 && (
            <li className="card px-6 py-8 text-center text-sm text-dim">
              Nobody left standing.
            </li>
          )}
        </ul>

        {out.length > 0 && (
          <>
            <div className="mb-2.5 mt-7 flex items-baseline gap-2">
              <h2 className="flex items-center gap-1.5 text-sm text-dim">
                <Skull size={13} aria-hidden />
                Out
              </h2>
              <span className="h-px flex-1 bg-chalk/10" aria-hidden />
              <span className="stat text-[11px] text-dim">{out.length}</span>
            </div>
            <ul className="flex flex-col gap-2">
              {out.map((e) => (
                <EntryCard
                  key={e.userId}
                  entry={e}
                  isMe={e.userId === userId}
                  pool={pool}
                  teams={scope.teams}
                  sport={sport}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <GroupRoster
        members={members}
        viewerId={userId}
        slug={group.slug}
        isAdmin={group.role === "admin"}
      />

      {/* The daily games, scored for this roster — a survivor pool has no
          board, but it has people, and that is all the arcade needs. */}
      <GroupArcade
        supabase={supabase}
        groupId={group.id}
        groupName={group.name}
        slug={group.slug}
        userId={userId}
        members={members}
      />
    </main>
  );
}

/**
 * One week of your own season: what you took, and what it did to you.
 *
 * The "where you stand" card above answers "am I alive" with a row of crests,
 * which is the right size for a glance and useless for the question the owner
 * asked — whether a pick actually went in. A week with no team says so in
 * words, and the week being viewed is marked so the log and the board overhead
 * are legibly the same week.
 */
function PickLogRow({
  result,
  team,
  sport,
  viewing,
}: {
  result: SurvivorWeekResult;
  team: import("../../../lib/slate").TeamView | null;
  sport: "cfb" | "nfl";
  /** This is the week the board above is showing. */
  viewing: boolean;
}) {
  const struck = isStrike(result.outcome);
  return (
    <li
      className={`card flex items-center gap-2.5 px-3 py-2 ${
        viewing ? "ring-1 ring-inset ring-accent/40" : ""
      }`}
    >
      {/* Fixed column so the log reads as a column of weeks rather than a
          ragged list. CFB's postseason label ("Bowls & CFP") is the long one and
          the only one that ever truncates, so it carries a title. */}
      <span
        className="stat w-20 shrink-0 truncate text-[11px] uppercase tracking-wider text-chalk/45"
        title={weekLabel(result, sport)}
      >
        {weekLabel(result, sport)}
      </span>
      {team ? (
        <>
          <TeamMark team={team} size={22} />
          <span className="min-w-0 flex-1 truncate text-sm text-chalk">{team.school}</span>
        </>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm text-dim">
          {result.outcome === "missed" ? "No pick — week closed" : "Nothing in yet"}
        </span>
      )}
      <span
        className={`stat shrink-0 text-[10.5px] uppercase tracking-wider ${
          result.outcome === "won"
            ? "text-win"
            : struck
              ? "text-loss"
              : team
                ? "text-accent"
                : "text-dim"
        }`}
      >
        {team && result.outcome === "pending" ? "in" : OUTCOME_WORD[result.outcome]}
      </span>
    </li>
  );
}

/**
 * One entrant: their name, their state, and the teams they have spent.
 *
 * The crests are the pool's real currency — "who is left" is a smaller question
 * than "who is left AND still has Georgia", and a name with a record does not
 * answer the second one.
 */
function EntryCard({
  entry,
  isMe,
  pool,
  teams,
  sport,
}: {
  entry: SurvivorEntry;
  isMe: boolean;
  pool: SurvivorPool;
  teams: Map<number, import("../../../lib/slate").TeamView>;
  sport: "cfb" | "nfl";
}) {
  return (
    <li
      className={`card px-3.5 py-2.5 ${entry.eliminated ? "opacity-60" : ""} ${
        isMe ? "ring-1 ring-inset ring-accent/40" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium text-chalk">{entry.name}</span>
          {isMe && (
            <span className="stat shrink-0 text-[10px] uppercase tracking-wider text-accent">
              you
            </span>
          )}
        </span>
        <span
          className={`stat shrink-0 text-[10.5px] uppercase tracking-wider ${
            entry.eliminated ? "text-loss" : "text-win"
          }`}
        >
          {entry.eliminated && entry.eliminatedIn
            ? `out · ${weekLabel(entry.eliminatedIn, sport).toLowerCase()}`
            : pool.strikes > 1
              ? `${pool.strikes - entry.strikes} left`
              : "alive"}
        </span>
      </div>
      {entry.usedTeamIds.length > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1">
          {entry.usedTeamIds.map((id, i) => {
            const t = teams.get(id);
            return t ? (
              <span key={`${id}-${i}`} title={t.school}>
                <TeamMark team={t} size={18} />
              </span>
            ) : null;
          })}
        </p>
      )}
    </li>
  );
}

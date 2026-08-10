import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameRow, PickRow, TeamRow } from "../../lib/db-types";
import { DEFAULT_TZ, kickParts } from "../../lib/kick";
import { formatRecord, tallyBy, type Tally } from "../../lib/records";
import { pickSideLabel } from "../../lib/slate";

/**
 * The other half of the ledger: pool picks, kept apart from money.
 *
 * The site is two products sharing a slate — a pick'em pool and a bet tracker
 * — and until now the ledger only knew about one of them. That left the picks
 * nowhere: to see what you had riding in a pool you opened the group, and if
 * you were in three pools you opened three groups. Worse, the temptation was
 * to fold picks into the ledger's totals, which would quietly corrupt the one
 * number the ledger exists to compute. A pick is not a bet: it is flat, it is
 * priced at −110 whatever the book said, and nobody paid for it.
 *
 * So: same page, separate tab, separate arithmetic, and a line at the top
 * saying so.
 */
export async function PicksTab({
  supabase,
  seasonId,
  userId,
}: {
  supabase: SupabaseClient;
  seasonId: number;
  userId: string;
}) {
  const { data: pickRows } = await supabase
    .from("picks")
    .select("*")
    .eq("season_id", seasonId)
    .eq("user_id", userId)
    .order("locked_at", { ascending: false });
  const picks = (pickRows ?? []) as PickRow[];

  if (picks.length === 0) {
    return (
      <section className="card px-6 py-12 text-center">
        <p className="display text-lg text-chalk/80">No pool picks this season</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-dim">
          Picks are made on a group&rsquo;s board, against the games that group&rsquo;s admin put
          in play.{" "}
          <Link href="/groups" className="font-medium text-accent underline-offset-2 hover:underline">
            Find your group
          </Link>
          .
        </p>
      </section>
    );
  }

  const gameIds = [...new Set(picks.map((p) => p.game_id))];
  const groupIds = [...new Set(picks.map((p) => p.group_id))];
  const [{ data: gameRows }, { data: groupRows }] = await Promise.all([
    supabase.from("games").select("id, start_ts, home_team_id, away_team_id").in("id", gameIds),
    supabase.from("groups").select("id, name, slug").in("id", groupIds),
  ]);
  const games = (gameRows ?? []) as Array<
    Pick<GameRow, "id" | "start_ts" | "home_team_id" | "away_team_id">
  >;
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: teamRows } =
    teamIds.length > 0
      ? await supabase.from("teams").select("id, school, abbreviation").in("id", teamIds)
      : { data: [] };

  const abbr = new Map(
    ((teamRows ?? []) as TeamRow[]).map((t) => [
      t.id,
      t.abbreviation ?? t.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase(),
    ]),
  );
  const gameById = new Map(games.map((g) => [g.id, g]));
  const groupById = new Map(
    ((groupRows ?? []) as Array<{ id: string; name: string; slug: string }>).map((g) => [g.id, g]),
  );

  const byGroup = tallyBy(picks, (p) => p.group_id);
  const groupCards = [...byGroup.entries()]
    .map(([id, t]) => ({ id, group: groupById.get(id), tally: t }))
    .sort((a, b) => (a.group?.name ?? "").localeCompare(b.group?.name ?? ""));

  const sideOf = (p: PickRow): string => {
    const g = gameById.get(p.game_id);
    if (!g) return "—";
    return pickSideLabel(
      p.market,
      p.side,
      p.line_at_pick === null ? null : Number(p.line_at_pick),
      abbr.get(g.home_team_id) ?? "?",
      abbr.get(g.away_team_id) ?? "?",
    );
  };
  const matchupOf = (p: PickRow): string => {
    const g = gameById.get(p.game_id);
    if (!g) return "";
    return `${abbr.get(g.away_team_id) ?? "?"} @ ${abbr.get(g.home_team_id) ?? "?"}`;
  };

  return (
    <>
      <p className="mb-4 text-xs leading-relaxed text-dim">
        Pool picks, kept out of the ledger above. They grade at a flat −110 by League Rules #6, so
        their units are a pool score, not money — nothing here touches your ROI or your bankroll.
      </p>

      <section className="mb-6 flex flex-col gap-2">
        {groupCards.map(({ id, group, tally }) => (
          <GroupRow key={id} name={group?.name ?? "A group"} slug={group?.slug} tally={tally} />
        ))}
      </section>

      <section className="card overflow-x-auto">
        <table className="stats w-full text-sm">
          <thead>
            <tr className="border-b border-chalk/20 text-left text-xs uppercase text-chalk/55">
              <th className="px-3 py-2">Pick</th>
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2 text-right">Kick</th>
              <th className="px-3 py-2 text-right">CLV</th>
              <th className="px-3 py-2 text-right">Result</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => {
              const g = gameById.get(p.game_id);
              const kick = g?.start_ts ? kickParts(g.start_ts, DEFAULT_TZ) : null;
              const group = groupById.get(p.group_id);
              return (
                <tr key={p.id} className="border-b border-chalk/5 last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/game/${p.game_id}`} className="block font-sans hover:text-accent">
                      {sideOf(p)}
                      <span className="stat block text-[10.5px] text-dim">{matchupOf(p)}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {group ? (
                      <Link href={`/groups/${group.slug}`} className="text-dim hover:text-accent">
                        {group.name}
                      </Link>
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-dim">
                    {kick ? `${kick.day} ${kick.time}` : "TBD"}
                  </td>
                  <td
                    className={`px-3 py-2 text-right ${
                      p.clv === null ? "" : p.clv > 0 ? "text-win" : p.clv < 0 ? "text-loss" : ""
                    }`}
                  >
                    {p.clv === null ? "–" : `${p.clv > 0 ? "+" : ""}${p.clv}`}
                  </td>
                  <td className="px-3 py-2 text-right uppercase">
                    {p.result ?? <span className="text-chalk/40">open</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** One pool's season, in the same card idiom the group hub uses for members. */
function GroupRow({ name, slug, tally }: { name: string; slug?: string; tally: Tally }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-chalk">{name}</span>
        <span className="stat block text-[10.5px] text-chalk/45">
          {tally.decided === 0
            ? "nothing graded yet"
            : tally.avgClv === null
              ? `${tally.decided} graded`
              : `avg CLV ${tally.avgClv > 0 ? "+" : ""}${tally.avgClv.toFixed(2)}`}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="stat block text-lg font-semibold leading-none text-chalk">
          {tally.decided > 0 ? formatRecord(tally) : "—"}
        </span>
        <span
          className={`stat block text-[11px] leading-tight ${
            tally.units > 0 ? "text-win" : tally.units < 0 ? "text-loss" : "text-chalk/45"
          }`}
        >
          {tally.decided > 0
            ? `${tally.units >= 0 ? "+" : ""}${tally.units.toFixed(1)} pool units`
            : " "}
        </span>
      </span>
    </>
  );
  return slug ? (
    <Link
      href={`/groups/${slug}`}
      className="card card-hover flex min-h-16 items-center gap-3 px-3.5 py-2.5"
    >
      {body}
    </Link>
  ) : (
    <div className="card flex min-h-16 items-center gap-3 px-3.5 py-2.5">{body}</div>
  );
}

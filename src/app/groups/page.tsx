import { ClipboardList, Ticket } from "lucide-react";
import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { CreateGroupForm, JoinGroupForm } from "../../components/group/GroupForms";
import type { BetRow, PickRow } from "../../lib/db-types";
import { fetchMyGroups } from "../../lib/groups";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { formatRecord, tally, tallyBy } from "../../lib/records";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Groups" };

/**
 * Every pool you're in, with your record in each. This replaces /crew, which
 * assumed a single implicit crew of "everyone with an account".
 */
export default async function GroupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);
  const groups = await fetchMyGroups(supabase, user?.id ?? null);

  // One query for every group's picks; RLS already limits it to groups the
  // viewer can see, and the tally is grouped in memory.
  const { data: pickRows } = user
    ? await supabase
        .from("picks")
        .select("group_id, user_id, result, units, clv")
        .eq("season_id", seasonId)
        .eq("user_id", user.id)
    : { data: [] };
  const myTallies = tallyBy(
    (pickRows ?? []) as Array<Pick<PickRow, "group_id" | "user_id" | "result" | "units" | "clv">>,
    (p) => p.group_id,
  );

  // A betting group has no picks — its number is your ledger, which is the
  // same ledger in every betting group you are in. Showing a pick'em tally
  // beside one would render a permanent em dash and read as "no action".
  const { data: betRows } = user
    ? await supabase
        .from("bets")
        .select("result, units, clv, payout_units")
        .eq("season_id", seasonId)
        .eq("user_id", user.id)
        .is("voided_at", null)
    : { data: [] };
  const myBetTally = tally(
    ((betRows ?? []) as Array<Pick<BetRow, "result" | "units" | "clv" | "payout_units">>).map(
      (b) => ({
        result: b.result,
        units: Number(b.units),
        payoutUnits: b.payout_units === null ? null : Number(b.payout_units),
        clv: b.clv === null ? null : Number(b.clv),
      }),
    ),
  );

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="text-2xl">Groups</h1>
        <p className="mb-6 text-sm leading-relaxed text-dim">
          Two kinds. A <span className="text-chalk">pick&rsquo;em pool</span> runs a board an admin
          sets each week. A <span className="text-chalk">betting group</span> has no board — it
          shows what everyone actually bet off the slate, who got there first, and how tailing
          them goes.
        </p>

        {!user ? (
          <section className="card px-6 py-10 text-center">
            <p className="text-sm text-dim">
              <Link
                href="/login"
                className="font-medium text-accent underline-offset-2 hover:underline"
              >
                Sign in
              </Link>{" "}
              to create a group or join one.
            </p>
          </section>
        ) : (
          <>
            {groups.length === 0 ? (
              <section className="card mb-6 px-6 py-8 text-center">
                <p className="text-sm text-chalk">You&rsquo;re not in a group yet.</p>
                <p className="mt-1 text-sm text-dim">
                  Create one and you&rsquo;re its admin, or join with a code.
                </p>
              </section>
            ) : (
              <ul className="mb-6 flex flex-col gap-2.5">
                {groups.map((g) => {
                  const t = g.kind === "betting" ? myBetTally : myTallies.get(g.id);
                  return (
                    <li key={g.id}>
                      <Link
                        href={`/groups/${g.slug}`}
                        className="card card-hover flex min-h-16 items-center justify-between gap-3 px-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-chalk">{g.name}</span>
                          <span className="stat flex items-center gap-1.5 text-xs text-dim">
                            {g.kind === "betting" ? (
                              <Ticket size={11} aria-hidden className="shrink-0 text-accent" />
                            ) : (
                              <ClipboardList size={11} aria-hidden className="shrink-0" />
                            )}
                            {g.kind === "betting" ? "Betting sheet" : "Pick’em"}
                            {" · "}
                            {g.role === "admin" ? "Admin" : "Member"}
                            {g.visibility === "public" ? " · public" : ""}
                          </span>
                        </span>
                        <span className="stat shrink-0 text-right">
                          <span className="block text-base font-semibold text-chalk">
                            {t && t.decided > 0 ? formatRecord(t) : "—"}
                          </span>
                          {g.kind === "betting" && t && t.decided > 0 && (
                            <span
                              className={`block text-[11px] leading-tight ${
                                t.units > 0 ? "text-win" : t.units < 0 ? "text-loss" : "text-dim"
                              }`}
                            >
                              {t.units >= 0 ? "+" : ""}
                              {t.units.toFixed(1)}u
                            </span>
                          )}
                          <span className="block text-[10px] uppercase tracking-wider text-chalk/40">
                            {g.kind === "betting" ? "your bets" : "this season"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <section className="card px-4 py-4">
                <h2 className="mb-3 text-sm text-accent">Start a group</h2>
                <CreateGroupForm />
              </section>
              <section className="card px-4 py-4">
                <h2 className="mb-3 text-sm text-accent">Join one</h2>
                <JoinGroupForm />
              </section>
            </div>
          </>
        )}
      </main>
    </>
  );
}

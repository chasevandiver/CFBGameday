import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { CreateGroupForm, JoinGroupForm } from "../../components/group/GroupForms";
import type { PickRow } from "../../lib/db-types";
import { fetchMyGroups } from "../../lib/groups";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { formatRecord, tallyBy } from "../../lib/records";
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

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="text-2xl">Groups</h1>
        <p className="mb-6 text-sm text-dim">
          A group&rsquo;s admin picks the games and the bet types. Yours can differ from week to
          week, and your picks in one never count in another.
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
                  const t = myTallies.get(g.id);
                  return (
                    <li key={g.id}>
                      <Link
                        href={`/groups/${g.slug}`}
                        className="card card-hover flex min-h-16 items-center justify-between gap-3 px-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-chalk">{g.name}</span>
                          <span className="stat text-xs text-dim">
                            {g.role === "admin" ? "Admin" : "Member"}
                            {g.visibility === "public" ? " · public" : ""}
                          </span>
                        </span>
                        <span className="stat shrink-0 text-right">
                          <span className="block text-base font-semibold text-chalk">
                            {t && t.decided > 0 ? formatRecord(t) : "—"}
                          </span>
                          <span className="block text-[10px] uppercase tracking-wider text-chalk/40">
                            this season
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

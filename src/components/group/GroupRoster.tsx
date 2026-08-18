import Link from "next/link";
import { UserPlus } from "lucide-react";
import { joinedLabel, type GroupMemberView } from "../../lib/groups";

/**
 * Who is in this group.
 *
 * Every group home already listed its members — but always *through* something:
 * pick'em ranks them by record, a betting group by units, survivor by who is
 * still alive. Each of those answers "how is everyone doing", and a person with
 * no picks, no bets and no entry sits at the bottom of a leaderboard reading
 * like a rounding error rather than like a member. So an admin who had just
 * added somebody had nowhere to go and see that it had worked, which is exactly
 * the report this section exists to answer.
 *
 * Deliberately plain, and deliberately last on the page: it is a reference, not
 * something anyone glances at during a game. Names, who runs the place, and
 * when each person came in — nothing that needs a number to be interesting.
 */
export function GroupRoster({
  members,
  viewerId,
  slug,
  isAdmin,
}: {
  members: GroupMemberView[];
  viewerId: string | null;
  slug: string;
  /** Admins get the way in from here; everyone else just reads it. */
  isAdmin: boolean;
}) {
  return (
    <section id="members" className="mt-7 scroll-mt-4" aria-labelledby="members-heading">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 id="members-heading" className="text-sm text-accent">
          Members
        </h2>
        <span className="h-px flex-1 bg-chalk/10" aria-hidden />
        <span className="stat text-[11px] text-dim">
          {members.length} {members.length === 1 ? "person" : "people"}
        </span>
      </div>

      <ul className="card px-3.5 py-1">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-chalk/5 py-2 last:border-0"
          >
            <span className="min-w-0 truncate text-sm text-chalk">
              {m.name}
              {m.userId === viewerId && <span className="text-dim"> (you)</span>}
              {m.role === "admin" && (
                <span className="stat ml-1.5 text-[10px] uppercase tracking-wider text-accent">
                  admin
                </span>
              )}
            </span>
            <span className="stat shrink-0 text-[11px] text-chalk/45">
              {joinedLabel(m.joinedAt)}
            </span>
          </li>
        ))}
      </ul>

      {isAdmin && (
        <Link
          href={`/groups/${slug}/settings`}
          className="stat mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-chalk/20 px-3 text-xs text-chalk hover:border-chalk/50"
        >
          <UserPlus size={13} aria-hidden />
          Add someone
        </Link>
      )}
    </section>
  );
}

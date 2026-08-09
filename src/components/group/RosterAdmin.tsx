"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { leaveGroup, removeGroupMember, setGroupRole } from "../../app/actions/groups";
import type { GroupMemberView } from "../../lib/groups";

/**
 * Roster management. The last-admin rule is enforced in the database (a
 * deferred constraint trigger plus an explicit guard in set_group_role), so
 * this does not try to predict it — it surfaces whatever the RPC says, which
 * keeps one statement of the rule instead of two that can drift.
 */
export function RosterAdmin({
  groupId,
  members,
  viewerId,
  viewerIsAdmin,
}: {
  groupId: string;
  members: GroupMemberView[];
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.message ?? "Could not do that");
      else router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-chalk/5 py-2 last:border-0"
          >
            <span className="min-w-0 truncate text-sm text-chalk">
              {m.name}
              {m.userId === viewerId && <span className="text-dim"> (you)</span>}
              <span className="ml-1.5 text-[10px] uppercase tracking-wider text-chalk/40">
                {m.role}
              </span>
            </span>
            {viewerIsAdmin && (
              <span className="flex shrink-0 gap-1.5">
                <button
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      setGroupRole(groupId, m.userId, m.role === "admin" ? "member" : "admin"),
                    )
                  }
                  className="stat min-h-11 rounded-lg border border-chalk/20 px-2.5 text-xs text-chalk hover:border-chalk/50 disabled:opacity-50"
                >
                  {m.role === "admin" ? "Make member" : "Make admin"}
                </button>
                {m.userId !== viewerId && (
                  <button
                    disabled={pending}
                    onClick={() => run(() => removeGroupMember(groupId, m.userId))}
                    className="stat min-h-11 rounded-lg border border-loss/40 px-2.5 text-xs text-loss hover:border-loss disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3 pt-1">
        <button
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await leaveGroup(groupId);
              if (res.ok) router.push("/groups");
              return res;
            })
          }
          className="stat min-h-11 rounded-lg border border-chalk/20 px-3 text-xs text-dim hover:border-loss hover:text-loss disabled:opacity-50"
        >
          Leave group
        </button>
        {error && <span className="text-xs text-loss">{error}</span>}
      </div>
    </div>
  );
}

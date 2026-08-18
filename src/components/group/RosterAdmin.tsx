"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  addGroupMember,
  addGroupMemberByName,
  leaveGroup,
  removeGroupMember,
  searchGroupCandidates,
  setGroupRole,
  type GroupCandidate,
} from "../../app/actions/groups";
import { joinedLabel, type GroupMemberView } from "../../lib/groups";

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
              {/* Said here as well as on the group page: this is the screen the
                  admin is standing on when they add somebody, so it is where
                  "it worked" has to be legible. */}
              <span className="stat ml-1.5 text-[11px] text-chalk/45">{joinedLabel(m.joinedAt)}</span>
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

      {viewerIsAdmin && <AddByName groupId={groupId} onDone={() => router.refresh()} />}

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

/**
 * The second way in (0064). The join code is still the first — it is the only
 * path for someone the admin cannot see yet — but most people an admin wants
 * in a group already have an account on an invite-only site, and for them the
 * code is a step that has to be sent, read and typed before anything happens.
 *
 * Search rather than a bare name field, because `display_name` is not unique:
 * the list resolves to an id, and the typed-name path only exists for the
 * admin who knows exactly who they mean. The database refuses an ambiguous
 * name rather than picking a person, and this shows the refusal.
 */
function AddByName({ groupId, onDone }: { groupId: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /* The results carry the term they answer, and only a result that still
     matches the box is rendered. That is what makes a stale reply — a slow
     search for "ca" landing after the admin has typed "carl" — invisible
     rather than a list that contradicts what is on screen, and it means the
     short-query case clears itself instead of needing a setState in the
     effect below. */
  const [found, setFound] = useState<{ term: string; people: GroupCandidate[] }>({
    term: "",
    people: [],
  });

  const term = query.trim();
  const people = found.term === term ? found.people : [];

  useEffect(() => {
    if (term.length < 2) return;
    const timer = setTimeout(async () => {
      const res = await searchGroupCandidates(groupId, term);
      if (res.ok) setFound({ term, people: res.people });
      else setError(res.message ?? "Could not search");
    }, 250);
    return () => clearTimeout(timer);
  }, [term, groupId]);

  const add = (fn: () => Promise<{ ok: boolean; message?: string }>, name: string) =>
    start(async () => {
      setError(null);
      setNote(null);
      const res = await fn();
      if (!res.ok) {
        setError(res.message ?? "Could not add them");
        return;
      }
      setNote(`${name} is in`);
      // Clearing the box clears the list with it — `people` is derived.
      setQuery("");
      onDone();
    });

  return (
    <div className="border-t border-chalk/8 pt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (term === "") return;
          add(() => addGroupMemberByName(groupId, term), term);
        }}
        className="flex flex-col gap-1.5"
      >
        <label className="text-xs text-dim" htmlFor="add-member">
          Add someone by name
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="add-member"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Dave…"
            aria-describedby="add-member-hint"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-chalk/25 bg-elev px-3 text-sm text-chalk"
          />
          <button
            type="submit"
            disabled={pending || term === ""}
            className="stat min-h-11 rounded-lg border border-chalk/20 px-3 text-xs text-chalk hover:border-chalk/50 disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
        <p id="add-member-hint" className="text-[11px] leading-snug text-dim">
          They need an account already, and they go straight onto the board — no code, nothing to
          accept. Anyone else: send them the join code below.
        </p>
      </form>

      {people.length > 0 && (
        <ul aria-label="Matching names" className="mt-1.5 flex flex-col">
          {people.map((p) => (
            <li
              key={p.id}
              className="flex min-h-11 items-center justify-between gap-2 border-b border-chalk/5 py-1.5 last:border-0"
            >
              <span className="min-w-0 truncate text-sm text-chalk">{p.name}</span>
              {p.membership === "member" ? (
                <span className="stat shrink-0 text-[11px] text-dim">already in</span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  // The submit button beside the box says "Add" too, and a row
                  // says nothing about who it is about out of context.
                  aria-label={`${p.membership === "removed" ? "Add back" : "Add"} ${p.name}`}
                  onClick={() => add(() => addGroupMember(groupId, p.id), p.name)}
                  className="stat min-h-11 shrink-0 rounded-lg border border-chalk/20 px-2.5 text-xs text-chalk hover:border-chalk/50 disabled:opacity-50"
                >
                  {p.membership === "removed" ? "Add back" : "Add"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p aria-live="polite" className="text-xs">
        {note && <span className="stat text-win">{note}</span>}
        {error && <span className="text-loss">{error}</span>}
      </p>
    </div>
  );
}

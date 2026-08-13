"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveGroup, regenerateJoinCode, setGroupLeagues, updateGroup } from "../../app/actions/groups";

/**
 * The parts of a group that aren't a week: its name, who can see it, its join
 * code, and retiring it.
 *
 * All four existed as RPCs with nothing calling them. Renaming matters most —
 * `create_group` set the name once and nothing could change it, so a typo was
 * permanent.
 */
export function GroupAdmin({
  groupId,
  name,
  visibility,
  hidePicks,
  leagues,
  joinCode,
}: {
  groupId: string;
  name: string;
  visibility: "private" | "public";
  hidePicks: boolean;
  /** Pick'em league scope (0042); the settings page only renders for pick'em. */
  leagues: Array<"cfb" | "nfl">;
  joinCode: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [draftName, setDraftName] = useState(name);
  const [draftVis, setDraftVis] = useState(visibility);
  const [draftHide, setDraftHide] = useState(hidePicks);
  const [draftLeagues, setDraftLeagues] = useState<Array<"cfb" | "nfl">>(leagues);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const leaguesDirty =
    [...draftLeagues].sort().join(",") !== [...leagues].sort().join(",");
  const dirty =
    draftName.trim() !== name ||
    draftVis !== visibility ||
    draftHide !== hidePicks ||
    leaguesDirty;

  const save = () =>
    start(async () => {
      setError(null);
      setNote(null);
      const res = await updateGroup(groupId, draftName, draftVis, draftHide);
      if (!res.ok) {
        setError(res.message ?? "Could not save");
        return;
      }
      if (leaguesDirty) {
        const leagueRes = await setGroupLeagues(groupId, draftLeagues);
        if (!leagueRes.ok) {
          setError(leagueRes.message ?? "Could not change the leagues");
          return;
        }
      }
      setNote("Saved");
      // The slug moves with the name, so the current URL is now stale.
      if (res.slug) router.replace(`/groups/${res.slug}/settings`);
      router.refresh();
    });

  const toggleLeague = (l: "cfb" | "nfl") =>
    setDraftLeagues((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-dim">Name</span>
        <input
          value={draftName}
          maxLength={60}
          onChange={(e) => setDraftName(e.target.value)}
          className="min-h-11 rounded-lg border border-chalk/25 bg-elev px-3 text-sm text-chalk"
        />
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-dim">Who can see the board</legend>
        {(["private", "public"] as const).map((v) => (
          <label key={v} className="flex min-h-11 items-center gap-2 text-sm text-chalk">
            <input
              type="radio"
              name="visibility"
              checked={draftVis === v}
              onChange={() => setDraftVis(v)}
            />
            {v === "private" ? "Members only" : "Anyone with the link"}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-dim">When picks become visible</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm text-chalk">
          <input
            type="radio"
            name="hide-picks"
            checked={!draftHide}
            onChange={() => setDraftHide(false)}
          />
          As soon as they&rsquo;re made
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-chalk">
          <input
            type="radio"
            name="hide-picks"
            checked={draftHide}
            onChange={() => setDraftHide(true)}
          />
          At each game&rsquo;s kickoff
        </label>
        <p className="text-[11px] leading-snug text-dim">
          Your own picks are always visible to you. Hiding the rest stops the group copying
          whoever&rsquo;s hot; the board still says how many are in.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-dim">Leagues on the board</legend>
        {(
          [
            ["cfb", "College football"],
            ["nfl", "NFL"],
          ] as const
        ).map(([l, label]) => (
          <label key={l} className="flex min-h-11 items-center gap-2 text-sm text-chalk">
            <input
              type="checkbox"
              checked={draftLeagues.includes(l)}
              // the RPC refuses an empty scope; don't offer the click that hits it
              disabled={draftLeagues.includes(l) && draftLeagues.length === 1}
              onChange={() => toggleLeague(l)}
            />
            {label}
          </label>
        ))}
        <p className="text-[11px] leading-snug text-dim">
          Each league keeps its own weeks and boards — CFB week 3 and NFL week 1 run side by
          side. Turning a league off hides its future boards; settled weeks keep their history.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={pending || !dirty || draftName.trim() === ""}
          className="stat min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {note && <span className="stat text-xs text-win">{note}</span>}
        {error && <span className="text-xs text-loss">{error}</span>}
      </div>

      <div className="border-t border-chalk/8 pt-4">
        <p className="mb-1 text-xs text-dim">
          Join code. Signing up is invite-only, so this routes people to the right group rather
          than guarding the door — regenerate it if it ends up somewhere it shouldn&rsquo;t.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="stat rounded-lg border border-chalk/20 px-3 py-2.5 text-sm tracking-widest text-chalk">
            {joinCode}
          </span>
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await regenerateJoinCode(groupId);
                if (!res.ok) setError(res.message ?? "Could not regenerate");
                else router.refresh();
              })
            }
            className="stat min-h-11 rounded-lg border border-chalk/20 px-3 text-xs text-chalk hover:border-chalk/50 disabled:opacity-50"
          >
            New code
          </button>
        </div>
      </div>

      <div className="border-t border-chalk/8 pt-4">
        {/* Archive, not delete: the picks stay gradeable and the history stays
            readable. It just stops appearing in anyone's list. */}
        {confirmArchive ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-chalk">Archive {name}? Picks and records are kept.</span>
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await archiveGroup(groupId);
                  if (!res.ok) setError(res.message ?? "Could not archive");
                  else router.push("/groups");
                })
              }
              className="stat min-h-11 rounded-lg border border-loss px-3 text-xs text-loss disabled:opacity-50"
            >
              Archive it
            </button>
            <button
              onClick={() => setConfirmArchive(false)}
              className="stat min-h-11 rounded-lg border border-chalk/20 px-3 text-xs text-dim"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmArchive(true)}
            className="stat min-h-11 rounded-lg border border-chalk/20 px-3 text-xs text-dim hover:border-loss hover:text-loss"
          >
            Archive group
          </button>
        )}
      </div>
    </div>
  );
}

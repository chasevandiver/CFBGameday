"use client";

import { ClipboardList, Ticket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createGroup, joinGroup, setActiveGroup } from "../../app/actions/groups";
import type { GroupKind } from "../../lib/db-types";

/**
 * Create and join, side by side. Both mint or restore a membership and then
 * make that group the active one, because the next thing you want after
 * either is to look at its board.
 */
export function CreateGroupForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        start(async () => {
          setError(null);
          const res = await createGroup(fd);
          if (!res.ok) setError(res.message ?? "Could not create the group");
          else if (res.slug) router.push(`/groups/${res.slug}`);
        })
      }
      className="flex flex-col gap-2"
    >
      <label className="text-xs text-dim" htmlFor="group-name">
        Group name
      </label>
      <input
        id="group-name"
        name="name"
        required
        maxLength={60}
        placeholder="Saturday Boys"
        className="min-h-11 rounded-lg border border-chalk/25 bg-elev px-3 text-sm text-chalk"
      />
      {/* The kind is the first real decision and it cannot be changed later —
          the two are different products sharing a roster — so it is a pair of
          described choices rather than a toggle with a label. */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-dim">
          What kind of group
          {/* Said before the choice, not after it. The two kinds store
              different things — a board and picks versus a read of everyone's
              ledger — so there is no honest conversion between them, and
              finding that out afterwards means rebuilding the group. */}
          <span className="stat text-[10px] uppercase tracking-wider text-edge">
            can&rsquo;t be changed later
          </span>
        </legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-chalk/15 p-2.5 text-sm has-[:checked]:border-accent/60 has-[:checked]:bg-accent/8">
          <input type="radio" name="kind" value="pickem" defaultChecked className="mt-0.5" />
          <span>
            <span className="flex items-center gap-1.5 text-chalk">
              <ClipboardList size={13} aria-hidden className="shrink-0" />
              Pick&rsquo;em pool
            </span>
            <span className="block text-[11px] leading-snug text-dim">
              An admin sets the games and bet types each week. Everyone picks the same board.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-chalk/15 p-2.5 text-sm has-[:checked]:border-accent/60 has-[:checked]:bg-accent/8">
          <input type="radio" name="kind" value="betting" className="mt-0.5" />
          <span>
            <span className="flex items-center gap-1.5 text-chalk">
              <Ticket size={13} aria-hidden className="shrink-0 text-accent" />
              Betting group
            </span>
            <span className="block text-[11px] leading-snug text-dim">
              No board. Bets you log from the slate show up on a shared sheet — first one on a
              game gets the credit, everyone after is tailing or fading.
            </span>
          </span>
        </label>
        <p className="text-[11px] leading-snug text-dim">
          Want both? Make two groups — the same people can be in each, and your bets and your
          picks stay separate.
        </p>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-dim">Who can see it</legend>
        <label className="flex items-center gap-2 text-sm text-chalk">
          <input type="radio" name="visibility" value="private" defaultChecked /> Members only
        </label>
        <label className="flex items-center gap-2 text-sm text-chalk">
          <input type="radio" name="visibility" value="public" /> Anyone with the link
        </label>
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="stat min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50"
      >
        Create group
      </button>
      {error && <p className="text-xs text-loss">{error}</p>}
    </form>
  );
}

export function JoinGroupForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        start(async () => {
          setError(null);
          const res = await joinGroup(fd);
          if (!res.ok) setError(res.message ?? "Could not join");
          else if (res.slug) router.push(`/groups/${res.slug}`);
        })
      }
      className="flex flex-col gap-2"
    >
      <label className="text-xs text-dim" htmlFor="join-code">
        Join code
      </label>
      <input
        id="join-code"
        name="code"
        required
        autoCapitalize="characters"
        placeholder="A1B2C3"
        className="stat min-h-11 rounded-lg border border-chalk/25 bg-elev px-3 text-sm uppercase tracking-widest text-chalk"
      />
      <button
        type="submit"
        disabled={pending}
        className="stat min-h-11 rounded-lg border border-chalk/25 px-4 text-sm font-semibold text-chalk disabled:opacity-50"
      >
        Join
      </button>
      {error && <p className="text-xs text-loss">{error}</p>}
    </form>
  );
}

/**
 * Switching groups is a navigation, not a filter — the board, the standings
 * and every pick control below it change together, so the URL should say which
 * group you are looking at.
 */
export function GroupSwitcher({
  groups,
  activeSlug,
}: {
  groups: Array<{ slug: string; name: string; kind: GroupKind }>;
  activeSlug: string;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  if (groups.length < 2) return null;

  return (
    <div className="scroll-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {groups.map((g) => {
        const betting = g.kind === "betting";
        const Icon = betting ? Ticket : ClipboardList;
        return (
          <button
            key={g.slug}
            onClick={() =>
              start(async () => {
                await setActiveGroup(g.slug);
                router.push(`/groups/${g.slug}`);
              })
            }
            aria-current={g.slug === activeSlug ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors ${
              g.slug === activeSlug
                ? "border-accent bg-accent/15 text-accent"
                : "border-chalk/20 text-dim hover:border-chalk/50"
            }`}
          >
            {/* Two chips that look identical land on two completely different
                pages, so the kind rides on the chip. The icon is coloured only
                for betting, where accent already means money everywhere else
                on the site — and the name is spelled out for anyone who can't
                use either cue. */}
            <Icon
              size={12}
              aria-hidden
              className={`shrink-0 ${betting && g.slug !== activeSlug ? "text-accent" : ""}`}
            />
            {g.name}
            <span className="sr-only"> — {betting ? "betting group" : "pick’em pool"}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Copy-to-clipboard for the join code, same pattern as the invite link. */
export function JoinCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className="stat min-h-11 rounded-lg border border-chalk/25 px-3 text-sm tracking-widest text-chalk"
      aria-label={`Join code ${code}. Tap to copy.`}
    >
      {copied ? "Copied" : code}
    </button>
  );
}

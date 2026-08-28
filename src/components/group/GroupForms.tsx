"use client";

import { ClipboardList, Ticket, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createGroup, joinGroup, setActiveGroup } from "../../app/actions/groups";
import { createSurvivorGroup } from "../../app/actions/survivor";
import type { GroupKind } from "../../lib/db-types";

/**
 * Create and join, side by side. Both mint or restore a membership and then
 * make that group the active one, because the next thing you want after
 * either is to look at its board.
 */
export function CreateGroupForm({ conferences = [] }: { conferences?: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /* Survivor needs three settings the other two kinds have no use for — league,
     conference, strikes — and it goes through its own RPC. Held in state rather
     than revealed with CSS so the fields are absent from the submission when
     the kind is not survivor, instead of being present and ignored. */
  const [kind, setKind] = useState<GroupKind>("pickem");
  const [sport, setSport] = useState<"cfb" | "nfl">("cfb");
  const [format, setFormat] = useState<"classic" | "extreme">("classic");

  return (
    <form
      action={(fd) =>
        start(async () => {
          setError(null);
          const res =
            kind === "survivor" ? await createSurvivorGroup(fd) : await createGroup(fd);
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
          <input
            type="radio"
            name="kind"
            value="pickem"
            defaultChecked
            onChange={() => setKind("pickem")}
            className="mt-0.5"
          />
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
          <input
            type="radio"
            name="kind"
            value="betting"
            onChange={() => setKind("betting")}
            className="mt-0.5"
          />
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
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-chalk/15 p-2.5 text-sm has-[:checked]:border-accent/60 has-[:checked]:bg-accent/8">
          <input
            type="radio"
            name="kind"
            value="survivor"
            onChange={() => setKind("survivor")}
            className="mt-0.5"
          />
          <span>
            <span className="flex items-center gap-1.5 text-chalk">
              <Trophy size={13} aria-hidden className="shrink-0 text-accent" />
              Survivor pool
            </span>
            <span className="block text-[11px] leading-snug text-dim">
              One winner a week, straight up. You can&rsquo;t use a team twice, and a loss puts
              you out.
            </span>
          </span>
        </label>
        <p className="text-[11px] leading-snug text-dim">
          Want more than one? Make more than one group — the same people can be in each, and your
          bets, your picks and your survivor run stay separate.
        </p>
      </fieldset>

      {kind === "survivor" && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-accent/25 bg-accent/5 p-2.5">
          <legend className="px-1 text-xs text-accent">Pool rules</legend>

          <div className="flex gap-2" role="group" aria-label="League">
            {(["cfb", "nfl"] as const).map((l) => (
              <label
                key={l}
                className="stat flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg border border-chalk/15 text-sm text-chalk has-[:checked]:border-accent has-[:checked]:bg-accent/15 has-[:checked]:text-accent"
              >
                <input
                  type="radio"
                  name="sport"
                  value={l}
                  defaultChecked={l === "cfb"}
                  onChange={() => setSport(l)}
                  className="sr-only"
                />
                {l.toUpperCase()}
              </label>
            ))}
          </div>

          {/* Conference is the normal CFB shape — "SEC survivor" — and is not
              offered for the NFL, where the pool is the league. */}
          {sport === "cfb" && (
            <label className="flex flex-col gap-1 text-xs text-dim">
              Conference
              <select
                name="conference"
                defaultValue=""
                className="min-h-11 rounded-lg border border-chalk/25 bg-elev px-3 text-sm text-chalk"
              >
                <option value="">All of college football</option>
                {conferences.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Two survivor games, one schema: classic is the format everyone
              knows, extreme is a race — as many teams a week as you dare,
              first to the target, one loss and out. */}
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Format">
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-chalk/15 p-2.5 text-sm has-[:checked]:border-accent/60 has-[:checked]:bg-accent/8">
              <input
                type="radio"
                name="format"
                value="classic"
                defaultChecked
                onChange={() => setFormat("classic")}
                className="mt-0.5"
              />
              <span>
                <span className="text-chalk">Classic</span>
                <span className="block text-[11px] leading-snug text-dim">
                  One team a week. A loss is a strike; run out of strikes and you&rsquo;re out.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-chalk/15 p-2.5 text-sm has-[:checked]:border-accent/60 has-[:checked]:bg-accent/8">
              <input
                type="radio"
                name="format"
                value="extreme"
                onChange={() => setFormat("extreme")}
                className="mt-0.5"
              />
              <span>
                <span className="text-chalk">Extreme</span>
                <span className="block text-[11px] leading-snug text-dim">
                  Pick as many teams a week as you dare — first to the win target takes it, but
                  one loss and you&rsquo;re out.
                </span>
              </span>
            </label>
          </div>

          {format === "classic" ? (
            <label className="flex flex-col gap-1 text-xs text-dim">
              Strikes before you&rsquo;re out
              <select
                name="strikes"
                defaultValue="1"
                className="min-h-11 rounded-lg border border-chalk/25 bg-elev px-3 text-sm text-chalk"
              >
                <option value="1">1 — classic, one loss and you&rsquo;re done</option>
                <option value="2">2 — one mulligan</option>
                <option value="3">3</option>
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs text-dim">
              First to how many wins
              <input
                type="number"
                name="target"
                defaultValue={100}
                min={5}
                max={500}
                inputMode="numeric"
                className="min-h-11 rounded-lg border border-chalk/25 bg-elev px-3 text-sm text-chalk"
              />
            </label>
          )}

          <label className="flex items-center gap-2 text-sm text-chalk">
            <input type="checkbox" name="reuse" /> Teams may be used more than once
          </label>
          <p className="text-[11px] leading-snug text-dim">
            {format === "classic"
              ? "A tie counts against you, and a week you don’t pick counts as a loss once every game in it has kicked off."
              : "A tie counts against you. A week you sit out costs no strike — it just wins you nothing."}
          </p>
        </fieldset>
      )}
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

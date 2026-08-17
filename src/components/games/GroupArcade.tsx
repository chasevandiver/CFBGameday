import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { fetchArcade } from "../../lib/arcade-data";
import { fetchGroupMembers, type GroupMemberView } from "../../lib/groups";
import { ArcadeBody } from "./ArcadeBoard";

/**
 * The Arcade on a group hub (R3-E3).
 *
 * Rendered for **all three kinds of group** — pick'em, survivor and betting —
 * because the arcade needs a roster, not a board. A survivor pool is a
 * perfectly good set of people to beat at the daily games, and telling its
 * members they have no arcade because their group has no `picks` rows would
 * be an implementation detail leaking into the product.
 *
 * It does its own reads rather than being threaded through three parent
 * components' prop lists; the roster is one small query and each hub is
 * already a server component doing its own.
 */
export async function GroupArcade({
  supabase,
  groupId,
  groupName,
  slug,
  userId,
  members,
}: {
  supabase: SupabaseClient;
  groupId: string;
  groupName: string;
  slug: string;
  userId: string | null;
  /** Passed in when the hub already fetched it; re-read otherwise. */
  members?: GroupMemberView[];
}) {
  const roster = members ?? (await fetchGroupMembers(supabase, groupId));
  const { standings, trophies } = await fetchArcade(
    supabase,
    {
      userIds: roster.map((m) => m.userId),
      nameById: new Map(roster.map((m) => [m.userId, m.name])),
    },
    userId,
  );

  return (
    <section className="mt-7" aria-labelledby="arcade-heading">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 id="arcade-heading" className="text-sm text-accent">
          The Arcade
        </h2>
        <span className="h-px flex-1 bg-chalk/10" aria-hidden />
        <Link
          href={`/games?g=${encodeURIComponent(slug)}`}
          className="stat text-[11px] text-dim hover:text-chalk"
        >
          Play →
        </Link>
      </div>
      <div className="card p-3.5">
        <p className="mb-3 text-xs leading-relaxed text-dim">
          The four daily games, scored together for {groupName}. You play once — your result is
          ranked in every pool you&rsquo;re in.
        </p>
        <ArcadeBody standings={standings} trophies={trophies} signedIn={userId !== null} />
      </div>
    </section>
  );
}

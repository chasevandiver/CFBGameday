import { describe, expect, it } from "vitest";
import { asClient, FakeSupabase } from "../../scripts/lib/fake-supabase";
import { fetchDoorPeople } from "./jarvis-door-data";

/**
 * JARVIS-1: who Jarvis is told it may log for. The roster narrows the
 * candidates; `can_log_bet_for` is still asked about each, so a name the
 * database would refuse never reaches Jarvis.
 */

const owner = "aaaaaaaa-0000-0000-0000-000000000001";
const hayden = "bbbbbbbb-0000-0000-0000-000000000002";
const eric = "cccccccc-0000-0000-0000-000000000003";
const gone = "dddddddd-0000-0000-0000-000000000004";
const poolOnly = "eeeeeeee-0000-0000-0000-000000000005";
const elsewhere = "ffffffff-0000-0000-0000-000000000006";

const world = () =>
  new FakeSupabase({
    groups: [
      { id: "g-bet", kind: "betting", archived_at: null },
      { id: "g-pool", kind: "pickem", archived_at: null },
      { id: "g-old", kind: "betting", archived_at: "2026-01-01T00:00:00Z" },
      { id: "g-member", kind: "betting", archived_at: null },
    ],
    group_members: [
      { group_id: "g-bet", user_id: owner, role: "admin", removed_at: null },
      { group_id: "g-bet", user_id: hayden, role: "member", removed_at: null },
      { group_id: "g-bet", user_id: eric, role: "member", removed_at: null },
      { group_id: "g-bet", user_id: gone, role: "member", removed_at: "2026-10-01T00:00:00Z" },
      { group_id: "g-pool", user_id: owner, role: "admin", removed_at: null },
      { group_id: "g-pool", user_id: poolOnly, role: "member", removed_at: null },
      { group_id: "g-old", user_id: owner, role: "admin", removed_at: null },
      { group_id: "g-old", user_id: poolOnly, role: "member", removed_at: null },
      // A betting group the owner is merely in gives no right to log for anyone.
      { group_id: "g-member", user_id: owner, role: "member", removed_at: null },
      { group_id: "g-member", user_id: elsewhere, role: "admin", removed_at: null },
    ],
    profiles: [
      { id: hayden, display_name: "Hayden" },
      { id: eric, display_name: "Eric" },
      { id: gone, display_name: "Gone" },
      { id: poolOnly, display_name: "Pool Only" },
      { id: elsewhere, display_name: "Elsewhere" },
    ],
  });

const client = (db: FakeSupabase, grant: (id: string) => boolean) => ({
  ...asClient(db),
  from: (t: string) => db.from(t),
  rpc: async (_fn: string, args: { p_user: string }) => ({ data: grant(args.p_user), error: null }),
});

describe("fetchDoorPeople", () => {
  it("lists current members of live betting groups the owner runs", async () => {
    const people = await fetchDoorPeople(client(world(), () => true), owner);
    expect(people).toEqual([
      { id: eric, name: "Eric" },
      { id: hayden, name: "Hayden" },
    ]);
  });

  it("drops anyone the grant refuses, whatever the roster says", async () => {
    const people = await fetchDoorPeople(client(world(), (id) => id === hayden), owner);
    expect(people).toEqual([{ id: hayden, name: "Hayden" }]);
  });

  it("is empty for someone who runs no betting group", async () => {
    expect(await fetchDoorPeople(client(world(), () => true), hayden)).toEqual([]);
  });
});

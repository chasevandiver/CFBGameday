import { describe, expect, it } from "vitest";
import { canLogBetFor, isUuid, resolveActingBettor } from "./log-for";

/**
 * 0083: the app-side relay of `can_log_bet_for`. The grant itself is the
 * database's (supabase/tests/log-bets-for.sql); this proves the TypeScript
 * asks the right question and fails closed on every non-answer.
 */

const admin = "aaaaaaaa-0000-0000-0000-000000000001";
const member = "bbbbbbbb-0000-0000-0000-000000000002";

function fake(answer: { data: unknown; error: unknown }, name: string | null = "Jeff") {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return answer;
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: name === null ? null : { display_name: name } }),
        }),
      }),
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls };
}

describe("isUuid", () => {
  it("accepts an id and refuses URL junk", () => {
    expect(isUuid(member)).toBe(true);
    expect(isUuid("jeff")).toBe(false);
    expect(isUuid(`${member}'`)).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("canLogBetFor", () => {
  it("relays the database's yes", async () => {
    const { client, calls } = fake({ data: true, error: null });
    expect(await canLogBetFor(client, member)).toBe(true);
    expect(calls).toEqual([{ fn: "can_log_bet_for", args: { p_user: member } }]);
  });

  it("fails closed on an error — the migration not applied, say", async () => {
    const { client } = fake({ data: null, error: { message: "function does not exist" } });
    expect(await canLogBetFor(client, member)).toBe(false);
  });

  it("treats anything but a literal true as no", async () => {
    const { client } = fake({ data: null, error: null });
    expect(await canLogBetFor(client, member)).toBe(false);
    const { client: c2 } = fake({ data: "true", error: null });
    expect(await canLogBetFor(c2, member)).toBe(false);
  });

  it("never sends a malformed id to the database", async () => {
    const { client, calls } = fake({ data: true, error: null });
    expect(await canLogBetFor(client, "not-an-id")).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("resolveActingBettor", () => {
  it("resolves a granted id to the member, named", async () => {
    const { client } = fake({ data: true, error: null }, "Jeff");
    expect(await resolveActingBettor(client, admin, member)).toEqual({ id: member, name: "Jeff" });
  });

  it("is null for yourself, for nobody, for a stranger and when signed out", async () => {
    const { client, calls } = fake({ data: true, error: null });
    expect(await resolveActingBettor(client, admin, admin)).toBeNull();
    expect(await resolveActingBettor(client, admin, null)).toBeNull();
    expect(await resolveActingBettor(client, admin, undefined)).toBeNull();
    expect(await resolveActingBettor(client, null, member)).toBeNull();
    // none of those asked the database
    expect(calls).toHaveLength(0);
    const { client: denied } = fake({ data: false, error: null });
    expect(await resolveActingBettor(denied, admin, member)).toBeNull();
  });

  it("still acts when the profile has no display name", async () => {
    const { client } = fake({ data: true, error: null }, null);
    expect(await resolveActingBettor(client, admin, member)).toEqual({ id: member, name: "them" });
  });
});

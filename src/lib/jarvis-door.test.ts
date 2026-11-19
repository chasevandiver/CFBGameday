import { describe, expect, it } from "vitest";
import { doorBetSchema, doorConfig, doorVoidSchema, firstIssue, tokenMatches } from "./jarvis-door";

/**
 * JARVIS-1: the parts of the door that are decided before any database is
 * asked — whether there is a door at all, whether the caller holds the key,
 * and whether what they sent is a bet a person could have said out loud.
 */

const token = "t".repeat(40);
const owner = "aaaaaaaa-0000-0000-0000-000000000001";

describe("doorConfig", () => {
  it("is absent unless both values are present and plausible", () => {
    const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
    expect(doorConfig(env({}))).toBeNull();
    expect(doorConfig(env({ JARVIS_DOOR_TOKEN: token }))).toBeNull();
    expect(doorConfig(env({ JARVIS_DOOR_USER_ID: owner }))).toBeNull();
    // A placeholder left in a dashboard is not a secret.
    expect(doorConfig(env({ JARVIS_DOOR_TOKEN: "changeme", JARVIS_DOOR_USER_ID: owner }))).toBeNull();
    expect(doorConfig(env({ JARVIS_DOOR_TOKEN: token, JARVIS_DOOR_USER_ID: "chase" }))).toBeNull();
    expect(doorConfig(env({ JARVIS_DOOR_TOKEN: ` ${token}\n`, JARVIS_DOOR_USER_ID: owner }))).toEqual({
      token,
      userId: owner,
    });
  });
});

describe("tokenMatches", () => {
  it("takes the exact bearer token and nothing else", () => {
    expect(tokenMatches(`Bearer ${token}`, token)).toBe(true);
    expect(tokenMatches(`bearer ${token}`, token)).toBe(true);
    expect(tokenMatches(null, token)).toBe(false);
    expect(tokenMatches("", token)).toBe(false);
    expect(tokenMatches(token, token)).toBe(false);
    expect(tokenMatches(`Bearer ${token}x`, token)).toBe(false);
    expect(tokenMatches(`Bearer ${token.slice(1)}`, token)).toBe(false);
    expect(tokenMatches(`Basic ${token}`, token)).toBe(false);
  });
});

describe("doorBetSchema", () => {
  const base = { game_id: 401, description: "Texas +4" };
  const says = (extra: object) => {
    const r = doorBetSchema.safeParse({ ...base, ...extra });
    return r.success ? "ok" : firstIssue(r.error);
  };

  it("accepts the three markets a person says out loud", () => {
    expect(says({ bet_type: "spread", side: "away", line: 4 })).toBe("ok");
    expect(says({ bet_type: "spread", side: "home", line: -3.5, units: 2, odds: -115 })).toBe("ok");
    expect(says({ bet_type: "spread", side: "home", line: 0 })).toBe("ok");
    expect(says({ bet_type: "moneyline", side: "home" })).toBe("ok");
    expect(says({ bet_type: "moneyline", side: "away", line: null, odds: 150 })).toBe("ok");
    expect(says({ bet_type: "total", side: "over", line: 51.5 })).toBe("ok");
    expect(says({ bet_type: "spread", side: "away", line: 4, for_user: owner })).toBe("ok");
  });

  it("refuses a market that does not match its side or its number", () => {
    expect(says({ bet_type: "spread", side: "away" })).toBe("A spread needs its number");
    expect(says({ bet_type: "spread", side: "over", line: 4 })).toBe("Pick a team");
    expect(says({ bet_type: "total", side: "home", line: 51.5 })).toBe("A total is over or under");
    expect(says({ bet_type: "total", side: "under" })).toBe("A total needs its number");
    expect(says({ bet_type: "moneyline", side: "home", line: -3 })).toBe("A moneyline has no number");
    expect(says({ bet_type: "spread", side: "home", line: 3.25 })).toBe("Lines move in half points");
  });

  it("refuses what the form would refuse, and what only the form may log", () => {
    expect(says({ bet_type: "future", side: "home" })).not.toBe("ok");
    expect(says({ bet_type: "team_total", side: "over", line: 24.5 })).not.toBe("ok");
    expect(says({ bet_type: "spread", side: "home", line: -3, units: 0 })).not.toBe("ok");
    expect(says({ bet_type: "spread", side: "home", line: -3, units: 500 })).not.toBe("ok");
    expect(says({ bet_type: "spread", side: "home", line: -3, odds: -50 })).toBe("Bad odds");
    expect(says({ bet_type: "spread", side: "home", line: -3, for_user: "hayden" })).toBe("Bad person");
    expect(says({ bet_type: "spread", side: "home", line: -3, description: "   " })).not.toBe("ok");
    expect(says({ bet_type: "spread", side: "home", line: -3, game_id: "401" })).not.toBe("ok");
  });

  it("carries nothing a caller could use to grade its own bet", () => {
    const r = doorBetSchema.safeParse({
      ...base,
      bet_type: "spread",
      side: "home",
      line: -3,
      result: "win",
      payout_units: 10,
      placed_at: "2020-01-01T00:00:00Z",
      logged_by: null,
      user_id: owner,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(Object.keys(r.data).sort()).toEqual(["bet_type", "description", "game_id", "line", "side"]);
    }
  });
});

describe("doorVoidSchema", () => {
  it("wants a bet id, and a real person if one is named", () => {
    expect(doorVoidSchema.safeParse({ id: 12 }).success).toBe(true);
    expect(doorVoidSchema.safeParse({ id: 12, for_user: owner }).success).toBe(true);
    expect(doorVoidSchema.safeParse({ id: "12" }).success).toBe(false);
    expect(doorVoidSchema.safeParse({ id: 12, for_user: "hayden" }).success).toBe(false);
    expect(doorVoidSchema.safeParse({}).success).toBe(false);
  });
});

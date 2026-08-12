import { describe, expect, it } from "vitest";
import { describeDbUrl } from "./db-url";

const REF = "mjijyutmbtnwcjspozsx";
const POOLER = "aws-0-us-east-2.pooler.supabase.com";
const good = `postgresql://postgres.${REF}:s3cr3tpw@${POOLER}:5432/postgres`;

describe("describeDbUrl", () => {
  it("passes the string the backup job actually needs", () => {
    const r = describeDbUrl(good);
    expect(r.verdict).toBe("ok");
    expect(r.user).toBe(`postgres.${REF}`);
    expect(r.port).toBe(5432);
    expect(r.database).toBe("postgres");
    expect(r.passwordLen).toBe(8);
  });

  it("never puts the password in anything printable", () => {
    const r = describeDbUrl(good);
    const printed = [r.summary, r.problem ?? ""].join(" ");
    expect(printed).not.toContain("s3cr3tpw");
    expect(printed).toContain("password_len=8");
  });

  // The real failure, three runs in a row.
  it("names the unqualified username on a pooler host as the cause", () => {
    const r = describeDbUrl(`postgresql://postgres:s3cr3tpw@${POOLER}:5432/postgres`);
    expect(r.verdict).toBe("error");
    expect(r.problem).toMatch(/postgres\.<project-ref>/);
    expect(r.problem).toMatch(/password may be perfectly fine/);
  });

  it("catches the transaction pooler port", () => {
    const r = describeDbUrl(`postgresql://postgres.${REF}:s3cr3tpw@${POOLER}:6543/postgres`);
    expect(r.verdict).toBe("error");
    expect(r.problem).toMatch(/6543/);
    expect(r.problem).toMatch(/5432/);
  });

  it("catches the IPv6-only direct host", () => {
    const r = describeDbUrl(`postgresql://postgres:s3cr3tpw@db.${REF}.supabase.co:5432/postgres`);
    expect(r.verdict).toBe("error");
    expect(r.problem).toMatch(/IPv6/);
  });

  it("warns on a password carrying URI-significant characters", () => {
    const r = describeDbUrl(`postgresql://postgres.${REF}:pa%40ss%2Fword@${POOLER}:5432/postgres`);
    expect(r.verdict).toBe("warn");
    expect(r.unsafe).toEqual(expect.arrayContaining(["@", "/"]));
    expect(r.problem).toMatch(/percent-encoded/);
  });

  // WHATWG's parser is lenient: it splits userinfo at the LAST `@`, so an
  // unencoded `@` in a password does not fail to parse — it silently produces a
  // different password than the one that was typed. Catching that is the
  // unsafe-character check's whole job, so this asserts the warn rather than a
  // parse error I assumed would happen and does not.
  it("does not choke on an unencoded @ in the password — it flags it", () => {
    const r = describeDbUrl("postgresql://postgres.ref:p@ssword@host.pooler.supabase.com:5432/db");
    expect(r.verdict).toBe("warn");
    expect(r.unsafe).toContain("@");
  });

  it("reports a genuinely unparseable value rather than throwing", () => {
    expect(() => describeDbUrl("not a url at all")).not.toThrow();
    const r = describeDbUrl("not a url at all");
    expect(r.verdict).toBe("error");
    expect(r.problem).toMatch(/could not parse/);
  });

  it("treats empty and unset alike", () => {
    for (const v of [undefined, "", "   "]) {
      const r = describeDbUrl(v);
      expect(r.verdict).toBe("error");
      expect(r.problem).toBe("not set");
    }
  });

  it("has no password to leak when there is no password", () => {
    const r = describeDbUrl(`postgresql://postgres.${REF}@${POOLER}:5432/postgres`);
    expect(r.verdict).toBe("error");
    expect(r.passwordLen).toBe(0);
  });
});

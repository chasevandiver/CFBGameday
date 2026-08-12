/**
 * What is actually in `SUPABASE_DB_URL` — described, never printed.
 *
 * "password authentication failed for user X" is the same message whether the
 * password is wrong or the USERNAME is, and against Supabase's pooler it is
 * usually the username: Supavisor routes by tenant, so it needs
 * `postgres.<project-ref>` and rejects a bare `postgres` as a bad credential
 * rather than saying "unknown tenant". Three backup runs were spent guessing
 * which of the two it was, because the only evidence was a message that reads
 * identically in both cases.
 *
 * So the job says what the string CONTAINS before it dials: username, host,
 * port, database, and the password's *length*. Never the password, never the
 * whole URL. Length alone separates "empty", "placeholder" and "real", which is
 * most of what goes wrong.
 *
 * Pure and total: every branch is decided from the string, so the whole thing
 * is testable without a network, a database, or a secret.
 */

export type Verdict = "ok" | "error" | "warn";

export interface DbUrlReport {
  verdict: Verdict;
  /** Safe to print. Contains no secret material. */
  summary: string;
  /** Present when verdict is not "ok". */
  problem?: string;
  user: string | null;
  host: string | null;
  port: number | null;
  database: string | null;
  passwordLen: number;
  /** URI-significant characters found in the password, which truncate it silently. */
  unsafe: string[];
}

/** Characters that end a URI component. In a password they must be percent-encoded. */
const URI_UNSAFE = ["@", "/", "?", "#", "[", "]", " "];

const POOLER = "pooler.supabase.com";
/** Supavisor's session mode. Transaction mode (6543) drops what pg_dump needs. */
const SESSION_PORT = 5432;
const TXN_POOLER_PORT = 6543;

export function describeDbUrl(raw: string | undefined): DbUrlReport {
  const base = {
    user: null,
    host: null,
    port: null,
    database: null,
    passwordLen: 0,
    unsafe: [] as string[],
  };

  if (!raw || raw.trim() === "") {
    return { ...base, verdict: "error", summary: "SUPABASE_DB_URL is empty", problem: "not set" };
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return {
      ...base,
      verdict: "error",
      summary: "SUPABASE_DB_URL is not a parseable URL",
      problem:
        "could not parse as a URI — check for an unencoded @ or / in the password, which ends the component early",
    };
  }

  const user = decodeURIComponent(u.username || "") || null;
  const password = decodeURIComponent(u.password || "");
  const host = u.hostname || null;
  const port = u.port ? Number(u.port) : null;
  const database = u.pathname.replace(/^\//, "") || null;
  const unsafe = URI_UNSAFE.filter((c) => password.includes(c));

  const facts = {
    user,
    host,
    port,
    database,
    passwordLen: password.length,
    unsafe,
  };
  const summary =
    `user=${JSON.stringify(user)} host=${JSON.stringify(host)} port=${port} ` +
    `db=${JSON.stringify(database)} password_len=${password.length}`;

  // The one that has actually bitten, first.
  if (host?.includes(POOLER) && !(user ?? "").startsWith("postgres.")) {
    return {
      ...facts,
      verdict: "error",
      summary,
      problem:
        `pooler host with an unqualified username (${JSON.stringify(user)}). Supabase's pooler routes by ` +
        `tenant and needs postgres.<project-ref>, e.g. postgres.abcdefghijklmnop. This is what ` +
        `"password authentication failed" means here — the password may be perfectly fine.`,
    };
  }

  if (port === TXN_POOLER_PORT) {
    return {
      ...facts,
      verdict: "error",
      summary,
      problem:
        "port 6543 is the transaction pooler, which drops the session-level features pg_dump needs. Use 5432.",
    };
  }

  if (host?.startsWith("db.") && host.endsWith(".supabase.co")) {
    return {
      ...facts,
      verdict: "error",
      summary,
      problem:
        "this is the direct-connection host, which is IPv6-only. GitHub Actions runners are IPv4, so it will " +
        "fail to connect. Use the session pooler host.",
    };
  }

  if (password.length === 0) {
    return { ...facts, verdict: "error", summary, problem: "no password in the URL" };
  }

  if (unsafe.length > 0) {
    return {
      ...facts,
      verdict: "warn",
      summary,
      problem:
        `password contains ${JSON.stringify(unsafe.join(""))} — these end a URI component unless ` +
        `percent-encoded, so the value reaching Postgres may be truncated. Resetting the password is ` +
        `easier than encoding it.`,
    };
  }

  if (host?.includes(POOLER) && port !== SESSION_PORT) {
    return {
      ...facts,
      verdict: "warn",
      summary,
      problem: `pooler host on port ${port}; the session pooler pg_dump needs is ${SESSION_PORT}.`,
    };
  }

  return { ...facts, verdict: "ok", summary };
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { consensusFromSnapshots } from "./consensus";
import { AGGREGATE_PROVIDERS } from "./providers";

describe("DQ-15 — an aggregate is not a book", () => {
  const snap = (provider: string, spread: number) => ({
    provider,
    captured_at: "2020-09-01T12:00:00Z",
    spread,
  });

  it("leaves the aggregate out when real books are present", () => {
    // The blend was being averaged against its own components: 6,029 games
    // carried `consensus` beside a book and the snapped line moved on 1,813.
    const withAggregate = consensusFromSnapshots([
      snap("consensus", -3),
      snap("teamrankings", -7),
      snap("numberfire", -7),
    ]);
    expect(withAggregate.spread).toBe(-7);
    // ...and the naive all-in mean would have been -5.667 -> -5.5.
    expect(withAggregate.spread).not.toBe(-5.5);
  });

  it("falls back to the aggregate when it is the only market", () => {
    // 486 games have `consensus` and nothing else, and 2015-2018 has no
    // per-book coverage at all. Dropping it outright would delete their market
    // rather than correct it.
    expect(consensusFromSnapshots([snap("consensus", -6.5)]).spread).toBe(-6.5);
  });

  it("counts teamrankings and numberfire as books", () => {
    // They are aggregator sites, so the case for excluding them is real — and
    // refused, because they are the only market for 2015-2018. Excluding them
    // could not improve a single line.
    expect(consensusFromSnapshots([snap("teamrankings", -7), snap("numberfire", -6)]).spread).toBe(
      -6.5,
    );
  });

  it("asks the question per MARKET, so a total-only book cannot delete a spread", () => {
    // Three archive games are exactly this shape: `consensus` posts a spread
    // and no total, while teamrankings and numberfire post a total and no
    // spread. A row-level rule saw "a book exists", dropped the aggregate, and
    // returned null for the only spread those games had — the fix deleting
    // lines. Found by checking the view against the rule rather than trusting
    // that it did what it said.
    const c = consensusFromSnapshots([
      { provider: "consensus", captured_at: "2020-09-01T12:00:00Z", spread: 2, total: null },
      { provider: "numberfire", captured_at: "2020-09-01T12:00:00Z", spread: null, total: 55.5 },
      { provider: "teamrankings", captured_at: "2020-09-01T12:00:00Z", spread: null, total: 56 },
    ]);
    expect(c.spread).toBe(2);
    // ...and the total still comes from the books alone, not from all three.
    expect(c.total).toBe(56);
  });

  it("applies the rule after the `before` cutoff, not before it", () => {
    // A closing consensus that drops every book on time and then re-admits the
    // aggregate would grade against a different market than the slate showed.
    const rows = [
      { provider: "consensus", captured_at: "2020-09-01T10:00:00Z", spread: -3 },
      { provider: "Bovada", captured_at: "2020-09-01T10:00:00Z", spread: -7 },
      { provider: "Bovada", captured_at: "2020-09-01T23:00:00Z", spread: -10 },
    ];
    expect(consensusFromSnapshots(rows, "2020-09-01T12:00:00Z").spread).toBe(-7);
  });
});

describe("the SQL mirrors have the same aggregate list", () => {
  // consensus.ts says the view and make_pick mirror it, and that is an
  // obligation: when they disagree, a pick is graded against a line the app
  // never showed. This file's own header records that exact bug from a
  // half-point rounding mismatch, so the list gets pinned rather than trusted.
  // Two files, because the rule lives in two applies: 0074 wrote both SQL
  // sites, and 0077 re-created the view per-market (MIG-1 — applied 08-19,
  // filed 08-20). Pinning only 0074 would pin a definition production no
  // longer runs. `make_pick` needs no per-market correction: its `latest` CTE
  // filters to the requested market before the books-exist test, so it was
  // per-market by construction — verified against the live function, not
  // assumed.
  const SQL = [
    "0074_consensus_excludes_aggregates.sql",
    "0077_consensus_excludes_aggregates_per_market.sql",
  ]
    .map((f) => readFileSync(join(__dirname, "../../supabase/migrations/", f), "utf8"))
    .join("\n");

  it("names every AGGREGATE_PROVIDERS entry in the migration", () => {
    for (const name of AGGREGATE_PROVIDERS) {
      expect(SQL, `${name} missing from 0074/0077`).toContain(`'${name}'`);
    }
  });

  it("excludes nothing in SQL that TypeScript still averages", () => {
    const listed = [...SQL.matchAll(/<> all \(array\[([^\]]+)\]\)/g)].flatMap((m) =>
      [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]),
    );
    expect(listed.length).toBeGreaterThan(0);
    for (const name of new Set(listed)) {
      expect(AGGREGATE_PROVIDERS.has(name), `SQL excludes ${name}, TypeScript does not`).toBe(true);
    }
  });

  it("applies the rule at both SQL sites, not just the view", () => {
    expect(SQL).toContain("create or replace view public.line_consensus");
    expect(SQL).toContain("create or replace function public.make_pick");
  });

  it("pins the per-market view, which is the definition production actually runs", () => {
    // The row-level rule dropped the aggregate whenever ANY book was present,
    // even one quoting the other market — three archive games lost the only
    // spread they had. The tell that 0077 is in the pin is the per-market
    // counts; 0074 has none.
    const perMarket = readFileSync(
      join(__dirname, "../../supabase/migrations/0077_consensus_excludes_aggregates_per_market.sql"),
      "utf8",
    );
    for (const col of ["books_spread", "books_total", "books_ml_home", "books_ml_away"]) {
      expect(perMarket, `${col} missing — 0077 is not the per-market view`).toContain(col);
    }
  });
});

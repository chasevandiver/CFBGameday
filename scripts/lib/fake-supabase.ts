/**
 * A tiny in-memory stand-in for the PostgREST client, for tests only.
 *
 * Everything interesting about `gradeGames` and `applyScoreboard` happens at
 * the database seam — which rows a query claims, which it skips, and whether a
 * second run finds anything left to do. A pure-function test cannot reach any
 * of that, and the real client needs a server. This covers the handful of chain
 * shapes the jobs and the admin actions actually use and nothing else: `select`
 * with `eq` / `in` / `is` filters, `order` and `range` (the paging shape
 * `pageAll` issues — FREEZE-3), `update` and `delete` (either optionally
 * followed by `select`), `insert`, and `maybeSingle`.
 *
 * It is deliberately NOT a Postgres emulator. RLS, triggers, constraints and
 * grants are the DB assertions' job (`supabase/tests/`, `npm run db:test`) —
 * this only proves the TypeScript asks the right questions.
 *
 * `reads` counts SELECTs per table, which is how the snapshot-narrowing in
 * `settleGames` is asserted: the cheap path is one that issues no query at all.
 */

export type FakeRow = Record<string, unknown>;

interface Result {
  data: FakeRow[] | FakeRow | null;
  error: { message: string; code?: string } | null;
}

type Mode = "select" | "update" | "insert" | "delete";

class FakeQuery implements PromiseLike<Result> {
  private filters: Array<(r: FakeRow) => boolean> = [];
  private mode: Mode = "select";
  private patch: FakeRow = {};
  private payload: FakeRow | FakeRow[] | null = null;
  private single = false;
  private orders: Array<{ col: string; ascending: boolean }> = [];
  private slice: [number, number] | null = null;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(): this {
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  in(col: string, vals: unknown[]): this {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }

  /** `.is(col, null)` is the ungraded filter; undefined counts as null. */
  is(col: string, val: unknown): this {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }

  /** Inclusive, like PostgREST's `Range` header: `.range(0, 999)` is 1,000 rows. */
  range(from: number, to: number): this {
    this.slice = [from, to];
    return this;
  }

  update(patch: FakeRow): this {
    this.mode = "update";
    this.patch = patch;
    return this;
  }

  /** One row or, as the slip does, several in one statement. */
  insert(row: FakeRow | FakeRow[]): this {
    this.mode = "insert";
    this.payload = row;
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  maybeSingle(): this {
    this.single = true;
    return this;
  }

  private run(): Result {
    const fail = this.db.failures.get(`${this.table}:${this.mode}`);
    if (fail) return { data: null, error: { message: fail } };

    const rows = this.db.rows(this.table);

    if (this.mode === "insert") {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]).map(
        (r) => ({ ...r }),
      );
      const unique = this.db.uniqueBy.get(this.table);
      if (
        unique &&
        incoming.some((row) => rows.some((r) => unique.every((c) => r[c] === row[c])))
      ) {
        return { data: null, error: { message: "duplicate key value", code: "23505" } };
      }
      rows.push(...incoming);
      return { data: incoming, error: null };
    }

    const matched = rows.filter((r) => this.filters.every((f) => f(r)));

    if (this.mode === "update") {
      for (const r of matched) Object.assign(r, this.patch);
      return { data: matched.map((r) => ({ ...r })), error: null };
    }

    if (this.mode === "delete") {
      const gone = matched.map((r) => ({ ...r }));
      for (const r of matched) rows.splice(rows.indexOf(r), 1);
      return { data: gone, error: null };
    }

    this.db.reads.set(this.table, (this.db.reads.get(this.table) ?? 0) + 1);
    let copies = matched.map((r) => ({ ...r }));
    if (this.orders.length > 0) {
      const cmp = (a: unknown, b: unknown) => (a === b ? 0 : (a as number) < (b as number) ? -1 : 1);
      copies.sort((a, b) => {
        for (const o of this.orders) {
          const c = cmp(a[o.col], b[o.col]);
          if (c !== 0) return o.ascending ? c : -c;
        }
        return 0;
      });
    }
    if (this.slice) copies = copies.slice(this.slice[0], this.slice[1] + 1);
    return { data: this.single ? (copies[0] ?? null) : copies, error: null };
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export class FakeSupabase {
  private readonly tables = new Map<string, FakeRow[]>();
  /** SELECTs issued per table. A table absent from this map was never read. */
  readonly reads = new Map<string, number>();
  /** `table:mode` → message, to make one operation fail on demand. */
  readonly failures = new Map<string, string>();
  /** Columns standing in for a unique index, so an insert can return 23505. */
  readonly uniqueBy = new Map<string, string[]>();

  constructor(seed: Record<string, FakeRow[]> = {}) {
    for (const [name, rows] of Object.entries(seed)) {
      this.tables.set(
        name,
        rows.map((r) => ({ ...r })),
      );
    }
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  rows(table: string): FakeRow[] {
    const existing = this.tables.get(table);
    if (existing) return existing;
    const fresh: FakeRow[] = [];
    this.tables.set(table, fresh);
    return fresh;
  }

  readCount(table: string): number {
    return this.reads.get(table) ?? 0;
  }
}

/**
 * The jobs take a real `SupabaseClient`. Casting through `unknown` keeps that
 * lie in one place instead of at every call site in the tests.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const asClient = (db: FakeSupabase): any => db;

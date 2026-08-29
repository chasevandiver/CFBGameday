import { readdirSync, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A server-safe `lib` module must not VALUE-import a `"use client"` one.
 *
 * The failure this exists for, 2026-08-29, launch Saturday: `group-share.ts`
 * imported `pickKey` from `session-picks.ts`, which carries `"use client"`
 * because it is a `useSyncExternalStore` store. Next.js compiles every export
 * of a client module into a server-side *reference stub* — calling one from a
 * server component throws "Attempted to call pickKey() from the server". So
 * every pick'em group hub and pick board rendered "Fumble on the play", in
 * production, while games were live. Betting and survivor groups branch before
 * that line and were fine, which is exactly why it reached a Saturday
 * unnoticed: the crash needed one kind of group and one code path.
 *
 * Neither typecheck nor lint sees this — the import is valid TypeScript and
 * the boundary is a Next.js runtime rule — and no unit test would either,
 * because vitest has no client/server split. A source scan is the only thing
 * that can hold it.
 *
 * **`import type` is deliberately allowed.** A type is erased before it
 * reaches the runtime, so it creates no stub and cannot be called;
 * `share-card-build.ts` imports `SlipSelection` from `bet-slip-store` that way
 * and is correct. The rule is about values, and the distinction is the point.
 */

const LIB = join(__dirname);

const isClientModule = (file: string): boolean =>
  /^\s*["']use client["']/.test(readFileSync(file, "utf8"));

/**
 * Comments out, then scan.
 *
 * Not optional: `share-card-build.ts`'s header prose contains the words
 * "import the client-only slip store", and a scanner reading raw source
 * matched that `import` and ran on to the real `from "./bet-slip-store"`
 * below it — reporting a violation in the one file that is doing this
 * correctly. The scanner must read code, not the commentary about it.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Relative specifiers this file imports at least one VALUE from. */
function valueImports(raw: string): string[] {
  const source = stripComments(raw);
  const out: string[] = [];
  /* `import ... from "./x"` — the clause is what decides value vs type.
     `[^;]` keeps the clause inside ONE statement: with `[\s\S]*?` a lazy match
     that fails on a bare-module specifier does not stop, it grows until it
     finds a later relative one — attributing `import type {…} from "./x"` to
     whatever `import … from "node:fs"` sat above it, which is exactly how the
     first draft of this file reported a false violation. */
  for (const m of source.matchAll(/import\s+([^;]*?)\s+from\s+["'](\.[^"']+)["']/g)) {
    const [, clause, spec] = m;
    if (/^type\b/.test(clause.trim())) continue; // `import type { A } from` — erased
    // A braced clause where EVERY specifier is `type X` is also fully erased.
    const braced = clause.match(/\{([\s\S]*)\}/);
    if (braced) {
      const specifiers = braced[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const hasValue = specifiers.some((s) => !/^type\b/.test(s));
      // A default or namespace binding outside the braces is itself a value.
      const outsideBraces = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
      if (!hasValue && outsideBraces === "") continue;
    }
    out.push(spec);
  }
  return out;
}

const libFiles = readdirSync(LIB)
  .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test."))
  .sort();

describe("the client/server boundary inside src/lib", () => {
  it("finds the lib modules to scan", () => {
    // Guard on the guard: a scan that silently matches nothing always passes.
    expect(libFiles.length).toBeGreaterThan(20);
    expect(libFiles).toContain("group-share.ts");
    expect(libFiles).toContain("session-picks.ts");
  });

  it("still has a client module and a server module to tell apart", () => {
    // If `session-picks` ever stops being a client module the regression this
    // file guards becomes unreproducible, and the scan below goes vacuous.
    expect(isClientModule(join(LIB, "session-picks.ts"))).toBe(true);
    expect(isClientModule(join(LIB, "group-share.ts"))).toBe(false);
  });

  it("no server-safe lib module value-imports a client module", () => {
    const violations: string[] = [];
    for (const file of libFiles) {
      const path = join(LIB, file);
      if (isClientModule(path)) continue; // a client module may import its own kind
      for (const spec of valueImports(readFileSync(path, "utf8"))) {
        for (const ext of [".ts", ".tsx"]) {
          const target = join(LIB, `${spec}${ext}`);
          if (existsSync(target) && isClientModule(target)) {
            violations.push(`${file} value-imports ${spec} ("use client")`);
          }
        }
      }
    }
    // Checked failing against the pre-fix tree: this listed
    // `group-share.ts value-imports ./session-picks ("use client")`.
    expect(violations).toEqual([]);
  });

  it("counts `import type` from a client module as safe", () => {
    // share-card-build.ts does exactly this and must keep passing.
    const src = readFileSync(join(LIB, "share-card-build.ts"), "utf8");
    expect(src).toMatch(/import type \{[^}]*\} from "\.\/bet-slip-store"/);
    expect(valueImports(src)).not.toContain("./bet-slip-store");
  });

  it("would catch a value import that hides among type specifiers", () => {
    // The shape a careless edit produces: one real binding in a braced clause
    // that is otherwise types.
    expect(valueImports(`import { type A, pickKey } from "./session-picks";`)).toEqual([
      "./session-picks",
    ]);
    expect(valueImports(`import { type A, type B } from "./session-picks";`)).toEqual([]);
    expect(valueImports(`import type { A } from "./session-picks";`)).toEqual([]);
    expect(valueImports(`import store, { type A } from "./session-picks";`)).toEqual([
      "./session-picks",
    ]);
  });
});

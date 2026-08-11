import { connection } from "next/server";

/**
 * Request time, for the demo pages.
 *
 * The demo's Saturday is placed against whenever someone opens the link, so
 * these pages genuinely need a per-request value — the case `connection()`
 * exists for. Reading the clock straight inside a component is both flagged as
 * impure and, without this, a value the prerenderer would happily bake in at
 * build time.
 *
 * It lives here rather than in `demo-data.ts` because that module is imported
 * by `/slate/preview`, which is a client component; `next/server` would make it
 * server-only and take the design harness down with it.
 */
export async function demoNow(): Promise<number> {
  await connection();
  return Date.now();
}

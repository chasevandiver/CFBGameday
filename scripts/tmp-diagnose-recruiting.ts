/**
 * TEMPORARY — delete with the CFBD-5 results commit.
 *
 * The history probe (run 32278070129) reported `/recruiting/teams` ERROR for
 * 2019–2023 with OK either side, after `cfbd.ts`'s built-in retry — so each of
 * those years failed twice. The manifest keeps only the verdict; this prints
 * the actual status per year, twice per year with a pause, so "CFBD 500s these
 * years" can be told apart from "we were rate-limited mid-probe". Also probes
 * `/recruiting/players` for one failing year as the fallback raw material.
 */
import { cfbd, CfbdError } from "../src/lib/cfbd";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tryYear(y: number) {
  try {
    const rows = await cfbd.recruitingTeams(y);
    console.log(`${y}: OK, ${rows.length} rows, ${rows.filter((r) => r.points !== null).length} with points`);
  } catch (e) {
    if (e instanceof CfbdError) console.log(`${y}: FAIL ${e.status} — ${e.message}`);
    else console.log(`${y}: FAIL (non-HTTP) — ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  for (const pass of [1, 2]) {
    console.log(`\n== /recruiting/teams pass ${pass} ==`);
    for (const y of [2019, 2020, 2021, 2022, 2023]) {
      await tryYear(y);
      await pause(2000);
    }
    if (pass === 1) await pause(10_000);
  }

  console.log("\n== control: a year that worked ==");
  await tryYear(2018);

  // Raw fetch: /recruiting/players is not on the typed client, and this file
  // dies with the diagnosis, so it does not earn a client method yet.
  console.log("\n== fallback raw material: /recruiting/players for 2021 ==");
  try {
    const res = await fetch("https://api.collegefootballdata.com/recruiting/players?year=2021", {
      headers: { Authorization: `Bearer ${process.env.CFBD_API_KEY}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.log(`FAIL ${res.status} ${res.statusText}`);
    } else {
      const players = (await res.json()) as unknown[];
      console.log(`OK, ${players.length} rows`);
    }
  } catch (e) {
    console.log(`FAIL — ${e instanceof Error ? e.message : String(e)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { AppNav } from "../../components/AppNav";
import { DEFAULT_PARAMS, MODEL_VERSION } from "../../model/ratings";
import { required } from "../../lib/db-result";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";
import { talentProvenance } from "../../lib/talent-provenance";

// One read, and it is the reason this page stopped being fully static: a
// preseason build that fell back to last season's talent file has to say so
// here, on the page that claims to explain what the number is made of. See
// src/lib/talent-provenance.ts and docs/STATUS.md Q1.
export const dynamic = "force-dynamic";

export const metadata = { title: "The Model" };

// The changelog's decisions log is the best thing in the repo — and lives in
// a git file the crew will never open (audit 10/G6). This surfaces the parts
// that make "the model was 8-3" falsifiable: which version, and which ideas
// were tried and rejected with the number that killed them. Kept as typed
// data (not a markdown parse) so it renders on the edge and can't drift into
// a broken table; update alongside docs/CHANGELOG.md.

const PARAMS: Array<{ name: string; value: string; how: string }> = [
  { name: "kFactor", value: "0.3", how: "Fitted, 2023–25 grid" },
  { name: "baseHfa", value: "3.0", how: "Fitted — was 2.3; the model was under-predicting home teams" },
  { name: "team HFA blend", value: "0.5, centered", how: "Mean pinned to baseHfa; per-team spread kept" },
  { name: "prior / talent weight", value: "0.70 / 0.30", how: "Fitted" },
  { name: "marginSigma", value: "16.8", how: "Fitted" },
  { name: "returning-prod weight", value: "6", how: "Fitted; interior point, not the argmin" },
  { name: "preseason tilt carry", value: "0.4", how: "Fitted — makes Week 0/1 totals real numbers" },
];

const DECISIONS: Array<{ idea: string; verdict: "shipped" | "rejected"; number: string }> = [
  { idea: "Home-field advantage 2.3 → 3.0", verdict: "shipped", number: "signed bias +0.74 → +0.03" },
  { idea: "Preseason off/def tilt carry", verdict: "shipped", number: "wks 1–2 totals MAE 13.34 vs 13.72" },
  { idea: "Churn restructure (fix a double-count)", verdict: "shipped", number: "removed a setting worse than no churn" },
  { idea: "Widen early-season sigma", verdict: "rejected", number: "NLL 0.3972 → 0.3992 (worse)" },
  { idea: "Blend SP+ / Elo into the rating", verdict: "rejected", number: "holdout 0.138 vs 0.15 bar" },
  { idea: "Per-play (EPA) efficiency margin", verdict: "rejected", number: "0.010 MAE, NLL degraded" },
  { idea: "New-coach penalty", verdict: "rejected", number: "unconverged; prior already encodes it" },
  { idea: "Treat flagged edges as bets", verdict: "rejected", number: "b₁ = 0.035 (t=0.84); 49.2% ATS vs close" },
];

export default async function ModelPage() {
  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);
  // `required`, not a dropped error: a failed read here would render the page
  // with no note, which is indistinguishable from a rating built on the real
  // file. That is the exact shape db-result.ts exists to stop.
  const components = required(
    await supabase.from("preseason_components").select("detail").eq("season_id", seasonId),
    "preseason components",
  );
  const talent = talentProvenance(components);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">The Model</h1>
          <span className="stat text-xs text-dim">version {MODEL_VERSION}</span>
        </div>
        <p className="mb-6 mt-1 text-sm text-dim">
          What the number on a card is made of, and what we tried that didn&rsquo;t earn a change.
          Every prediction is stamped with the model version that made it, so a season record
          attributes to a specific model — not a moving target.
        </p>

        {talent.stale && (
          <section className="card mb-6 p-4">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm text-accent">
                Built on the {talent.source ?? "previous"} talent file
              </h2>
              <span className="chip stat bg-chalk/10 text-chalk/60">{talent.teams} teams</span>
            </div>
            <p className="text-sm text-dim">
              CFBD had not published the {seasonId} team-talent composite when these ratings were
              built, so no incoming recruiting class is in the number. Talent is{" "}
              {DEFAULT_PARAMS.talentWeight.toFixed(2)} of a preseason rating, so the error is
              roughly 1&ndash;2 points a team, and it shrinks every week as results replace the
              prior. The note clears itself the next time the ratings rebuild on the real file.
            </p>
          </section>
        )}

        {talent.substitute && (
          <section className="card mb-6 p-4">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm text-accent">
                Talent baseline built from recruiting classes
              </h2>
              <span className="chip stat bg-chalk/10 text-chalk/60">
                {talent.substituteTeams} teams
              </span>
            </div>
            <p className="text-sm text-dim">
              CFBD had not published the {seasonId} team-talent composite when these ratings were
              built, so the baseline is a roster estimate from the last four recruiting classes
              &mdash; the same material the composite is derived from, incoming class included.
              The substitute was validated against the composite on the backtest before it was
              allowed to ship, and what it cannot see (portal moves) the model prices separately.
              The note clears itself the next time the ratings rebuild on the real composite.
            </p>
          </section>
        )}

        <section className="card mb-6 p-4">
          <h2 className="mb-3 text-sm text-accent">Current parameters</h2>
          <div className="overflow-x-auto">
            <table className="stats w-full text-sm">
              <tbody>
                {PARAMS.map((p) => (
                  <tr key={p.name} className="border-t border-chalk/8 first:border-0">
                    <td className="py-2 pr-3 font-medium">{p.name}</td>
                    <td className="py-2 pr-3 text-accent">{p.value}</td>
                    <td className="py-2 text-xs text-dim">{p.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="mb-1 text-sm text-accent">What we tried</h2>
          <p className="mb-3 text-xs text-chalk/60">
            The rejections are the point: each carries the number that decided it. Several of these
            sound obviously correct and will get proposed again.
          </p>
          <ul className="flex flex-col gap-2">
            {DECISIONS.map((d) => (
              <li key={d.idea} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-chalk/8 pt-2 first:border-0 first:pt-0">
                <span className="text-sm">{d.idea}</span>
                <span className="flex items-baseline gap-2">
                  <span className="stat text-xs text-dim">{d.number}</span>
                  <span
                    className={`chip ${d.verdict === "shipped" ? "bg-win/12 text-win" : "bg-chalk/10 text-chalk/60"}`}
                  >
                    {d.verdict}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

import { AppNav } from "../../components/AppNav";
import { MODEL_VERSION } from "../../model/ratings";

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

export default function ModelPage() {
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

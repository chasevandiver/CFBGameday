import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { ConsensusChip, EdgeChip } from "../../components/slate/chips";
import { kickParts, tzLabel, DEFAULT_TZ } from "../../lib/kick";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../lib/queries";
import {
  edgeVsOpener,
  fmtSpread,
  isDead,
  isFinal,
  lineForSide,
  modelSideOf,
  spreadMoveRead,
  type GameView,
} from "../../lib/slate";
import { SOFT_MARKET_LABEL, softMarketTags } from "../../lib/soft-markets";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edges" };

/**
 * This week's flagged games, biggest disagreement with the market first.
 *
 * Presented as information, not as bets. The 2023–25 backtest put these
 * disagreements at 49.2% against the closing line (52.4% breaks even at −110),
 * and the encompassing regression showed the model contributes nothing once
 * the closing line is in the equation (b=0.035, t=0.84, vs the market's 0.987).
 * The ¼-Kelly stake that used to live here implied an edge that isn't there.
 *
 * Two things survive that verdict, and they lead the page (Aug 2026): the
 * opener bucket — the one slice with a measured residual, 51.8% / +0.27 CLV
 * against the OPENING line, with its pre-registered in-season test on
 * Receipts (03:M-5) — and SPEC §5.1's soft-market taxonomy (F11), which
 * claims structural softness about the market, never profit. No other bucket
 * gets a heading: the splits that looked bettable were hunted and were noise
 * (docs/CHANGELOG.md, "beware the bucket that clears").
 */
export default async function EdgesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId, week, seasonType } = await fetchCurrentSeasonWeek(supabase);
  const data = await fetchSlateView(supabase, seasonId, week, user?.id ?? null, seasonType);

  const flagged = data.games
    .filter((g) => g.prediction?.edgeFlag && !isDead(g) && !isFinal(g))
    .sort((a, b) => {
      const big = (g: GameView) => (g.prediction?.edgeFlag === "BIG_EDGE" ? 1 : 0);
      if (big(b) !== big(a)) return big(b) - big(a);
      return Math.abs(b.prediction?.edge ?? 0) - Math.abs(a.prediction?.edge ?? 0);
    });

  // The opener bucket leads because it is the one slice with a real measured
  // residual (51.8%, avg CLV +0.27 vs the OPENER in 2023–25 — see 03:M-5 and
  // the pre-registered test on Receipts). Every other split of these flags was
  // hunted for and came back noise — the 6–10 band's 53.5% is the documented
  // trap ("beware the bucket that clears", docs/CHANGELOG.md) — so no other
  // bucket gets a heading.
  const openerBucket = flagged.filter((g) => {
    const e = edgeVsOpener(g);
    return e !== null && Math.abs(e) >= 4;
  });
  const rest = flagged.filter((g) => !openerBucket.includes(g));

  const anyFrozen = flagged.some((g) => g.prediction?.frozen);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-1 flex items-baseline justify-between">
          <h1 className="text-2xl">Edges</h1>
          <p className="stat text-xs text-chalk/50">week {week}</p>
        </div>
        <p className="mb-5 text-sm text-dim">
          Games where the model disagrees with the market by 2+ points. These are{" "}
          <span className="text-chalk/80">information, not recommendations</span> — over 2023–25
          these disagreements went 49.2% against the closing line, below the 52.4% a −110 bet needs
          to break even.
          {!anyFrozen && flagged.length > 0 && " Prices are unfrozen until Thursday 10pm CT."}
        </p>
        {/* Why there is no stake here: the encompassing regression
            (backtest.ts --diagnose-edges) puts the model's coefficient at 0.035
            (t=0.84) once the closing line is in the equation, against the
            market's 0.987 — the close already contains everything we know, so a
            raw disagreement is mostly our own error. Same standard the O/U
            leans have always been held to. */}

        {flagged.length === 0 ? (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">No flagged edges yet</p>
            <p className="mt-1 text-sm text-dim">
              Edges post with the Thursday freeze — check back once this week&rsquo;s predictions
              are priced.
            </p>
          </div>
        ) : (
          <>
            {openerBucket.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-1 text-sm text-accent">4+ vs the opener</h2>
                <p className="mb-3 text-xs leading-relaxed text-dim">
                  The one slice with a measured residual: in 2023–25 these went 51.8% with +0.27
                  CLV against the <span className="text-chalk/80">opening</span> line — the market
                  drifts toward the model early, and the close absorbs it. Still under the 52.4% a
                  −110 bet needs, so this is about price, not picks: the list to shop early if a
                  bet was happening anyway. This season&rsquo;s pre-registered verdict is tracked
                  on{" "}
                  <Link href="/receipts" className="text-accent underline-offset-2 hover:underline">
                    Receipts
                  </Link>
                  .
                </p>
                <ul className="flex flex-col gap-3">
                  {openerBucket.map((g) => (
                    <EdgeRow key={g.id} game={g} season={seasonId} />
                  ))}
                </ul>
              </section>
            )}
            {rest.length > 0 && (
              <section>
                {openerBucket.length > 0 && (
                  <h2 className="mb-1 text-sm text-accent">The rest of the flags</h2>
                )}
                {openerBucket.length > 0 && (
                  <p className="mb-3 text-xs leading-relaxed text-dim">
                    Flagged on the freeze-time line only. No other split of these games survived
                    the backtest — the buckets that looked bettable were noise, and they were
                    checked.
                  </p>
                )}
                <ul className="flex flex-col gap-3">
                  {rest.map((g) => (
                    <EdgeRow key={g.id} game={g} season={seasonId} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {/* SPEC §5.1's permanent taxonomy (F11): where the market itself is the
            softer opponent. Editorial by design — the two tags the data can
            actually derive (G5, weekday) also appear on the rows above, and
            the judgment calls stay words, because nothing in this database
            knows a depth chart. */}
        <section className="mt-8">
          <h2 className="mb-1 text-sm text-accent">Where CFB markets stay soft</h2>
          <p className="mb-3 text-xs leading-relaxed text-dim">
            &ldquo;Soft&rdquo; is a claim about the opponent, not a promise of profit: the 49.2%
            verdict above was measured against closing lines across the whole board. These are the
            pools where the close itself gets the least sharp attention — thin limits, few
            syndicate models — and where a disagreement is worth a second look. The only
            verification that counts is CLV.
          </p>
          <div className="card px-4 py-3.5">
            <ul className="flex flex-col gap-2.5 text-sm text-chalk/85">
              <SoftItem label="G5 games and FCS matchups">
                The sharpest inputs cover the P4 board first. G5-vs-G5 games are tagged on the
                flags above.
              </SoftItem>
              <SoftItem label="Weekday MACtion">
                Tuesday and Wednesday kicks price on a quiet board; tagged above when they carry a
                flag.
              </SoftItem>
              <SoftItem label="September lines, before the market learns rosters">
                Our numbers are priced before the market finishes learning new rosters — the
                measured version of this is the opener drift at the top of the page, and it is
                worth about a quarter of a point, not a bankroll.
              </SoftItem>
              <SoftItem label="Backup QB situations">
                Depth-chart news moves these lines slowly and unevenly. Editorial only — nothing
                in this database knows a depth chart, so no tag pretends otherwise.
              </SoftItem>
              <SoftItem label="Small-conference totals">
                Totals get less attention than sides everywhere, and small-conference totals least
                of all.
              </SoftItem>
              <SoftItem label="August win totals and big-spread backdoors">
                Derivative and futures markets price the last score and the long tail worst.
                Nothing here prices them yet — listed so the soft map is honest about what it
                covers.
              </SoftItem>
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}

function SoftItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="text-xs leading-relaxed text-dim">
      <span className="font-medium text-chalk/85">{label}.</span> {children}
    </li>
  );
}

function EdgeRow({ game, season }: { game: GameView; season: number }) {
  const p = game.prediction!;
  const modelSide = modelSideOf(p);
  const sideTeam = modelSide === null ? null : modelSide === "home" ? game.home : game.away;
  const kick = game.startTs ? kickParts(game.startTs, DEFAULT_TZ) : null;
  const marketSpread = p.vegasSpread ?? game.lines.spread;
  // Structural tags only (SPEC §5.1) — a claim about the market's attention,
  // never about this game being a good bet.
  const soft = softMarketTags(game, season, DEFAULT_TZ);
  const open = game.lines.spreadOpen;
  const move = spreadMoveRead(game);

  return (
    <li className="card card-hover relative px-4 py-3.5">
      <Link
        href={`/game/${game.id}`}
        aria-label={`${game.away.school} at ${game.home.school}`}
        className="absolute inset-0 rounded-[12px] focus-visible:outline-2 focus-visible:outline-accent"
      />
      <div className="pointer-events-none flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="scorebug truncate text-[15px] text-chalk">
            {game.away.school} @ {game.home.school}
          </p>
          <p className="stat mt-0.5 text-[11px] text-dim">
            {kick ? `${kick.day} ${kick.time} ${tzLabel(DEFAULT_TZ)}` : "TBD"}
            {game.tv ? ` · ${game.tv}` : ""}
            {p.frozen ? " · frozen" : " · unfrozen"}
            {soft.map((t) => ` · ${SOFT_MARKET_LABEL[t]}`).join("")}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <EdgeChip flag={p.edgeFlag} edge={p.edge} />
          <ConsensusChip on={p.consensus} />
        </div>
      </div>
      {/* No cover prob here: the normal-CDF number prices the model's margin at
          full weight against the market, and the edge gate measured that weight
          at 0.034 — printing "62%" three lines under the 49.2% disclaimer was
          the one surface still dressing a lean up as a bet. */}
      <div className="stat pointer-events-none mt-2.5 grid grid-cols-3 gap-2 text-center text-xs">
        <EdgeStat label="Market" value={`${game.home.abbr} ${fmtSpread(marketSpread)}`} />
        <EdgeStat label="Model" value={`${game.home.abbr} ${fmtSpread(p.spread)}`} />
        <EdgeStat
          label="Model lean"
          value={
            // the ticket the lean implies — an away lean holds +marketSpread
            modelSide && sideTeam
              ? `${sideTeam.abbr} ${fmtSpread(lineForSide(modelSide, marketSpread))}`
              : "–"
          }
        />
      </div>
      {open !== null && (
        // The price story since the opener — the movement the opener test
        // grades. "toward/away" only prints on a ≥1.5-pt move with a model
        // side, same bar as spreadMoveRead everywhere else.
        <p className="stat pointer-events-none mt-1.5 text-[11px] text-dim">
          opened {game.home.abbr} {fmtSpread(open)}
          {move !== null && ` · now ${fmtSpread(game.lines.spread)}`}
          {move?.vsModel === "toward"
            ? " · toward the model"
            : move?.vsModel === "away"
              ? " · away from the model"
              : ""}
        </p>
      )}
    </li>
  );
}

function EdgeStat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-elev px-2 py-2 ring-1 ring-inset ring-chalk/8">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-chalk/40">{label}</p>
      <p className={`mt-0.5 text-sm ${strong ? "font-semibold text-accent" : "text-chalk"}`}>{value}</p>
    </div>
  );
}

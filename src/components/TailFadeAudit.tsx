import { formatRecord, type Tally } from "../lib/records";

/**
 * "Where your edge actually is", rebuilt on who you followed (LEDGER-1).
 *
 * This replaces the reason-tag audit, which asked every bet to carry a
 * self-reported label from a list of eight. The owner's read was that only two
 * of those eight — tail and fade — were pulling their weight, and that those
 * two should be automatic. They already were: `src/lib/tailing.ts` derives
 * origin / tail / fade from arrival order inside a betting group, and has since
 * betting groups shipped.
 *
 * So the same question is asked of a fact rather than of a person. The old
 * table could only be as honest as the tag someone picked in a hurry at the bet
 * slip; this one cannot be gamed, because nobody enters it.
 *
 * ## Two tables, because they answer different questions
 *
 * The first splits the viewer's own season three ways. **Origin** is the bets
 * they opened — what they are worth as a source. **Tail** and **Fade** are the
 * ones that followed somebody. A bettor whose tails beat their origins is
 * better off waiting; one whose origins beat their tails should stop reading
 * the sheet.
 *
 * The second is `pairStatsFor`'s question — "am I better off just copying
 * Jeff?" — which `tailing.ts:210-217` notes is not answerable from anyone's own
 * record, because a source's record counts the bets you never saw in time to
 * copy.
 *
 * ## Per group, not pooled
 *
 * Origination means "first in this group", so merging two groups' bets into one
 * crowd would change who was first and quietly invent tails that never
 * happened. Each betting group gets its own block.
 */

export interface RelationRow {
  key: "origin" | "tail" | "fade";
  label: string;
  hint: string;
  tally: Tally;
}

export interface PairRow {
  name: string;
  tailing: Tally;
  fading: Tally;
}

export interface AuditGroup {
  groupId: string;
  groupName: string;
  rows: RelationRow[];
  pairs: PairRow[];
}

const unitsClass = (n: number): string =>
  n > 0 ? "text-win" : n < 0 ? "text-loss" : "";

function UnitsCell({ t }: { t: Tally }) {
  return (
    <td className={`px-3 py-2 text-right ${unitsClass(t.units)}`}>
      {t.units >= 0 ? "+" : ""}
      {t.units.toFixed(1)}
    </td>
  );
}

export function TailFadeAudit({ groups }: { groups: AuditGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <>
      {groups.map((g) => (
        <section key={g.groupId} className="card mb-6 overflow-x-auto">
          <h2 className="border-b border-chalk/8 px-4 py-2.5 text-sm text-accent">
            Where your edge actually is
            {groups.length > 1 && <span className="text-dim"> · {g.groupName}</span>}
          </h2>

          <table className="stats w-full text-sm">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-chalk/55">
                <th className="py-2 pl-4 pr-3 font-semibold">Your bets</th>
                <th className="px-3 py-2 text-right font-semibold">Record</th>
                <th className="px-3 py-2 text-right font-semibold">Units</th>
                <th className="px-3 py-2 text-right font-semibold">ROI</th>
                <th className="py-2 pl-3 pr-4 text-right font-semibold">CLV</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.key} className="border-t border-chalk/5">
                  <td className="py-2 pl-4 pr-3 font-sans text-chalk">
                    {r.label}
                    <span className="block text-[10.5px] text-dim">{r.hint}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-chalk/80">{formatRecord(r.tally)}</td>
                  <UnitsCell t={r.tally} />
                  <td className="px-3 py-2 text-right text-chalk/80">
                    {r.tally.roi === null ? "–" : `${(r.tally.roi * 100).toFixed(0)}%`}
                  </td>
                  <td
                    className={`py-2 pl-3 pr-4 text-right ${
                      r.tally.avgClv === null ? "" : unitsClass(r.tally.avgClv)
                    }`}
                  >
                    {r.tally.avgClv === null
                      ? "–"
                      : `${r.tally.avgClv > 0 ? "+" : ""}${r.tally.avgClv.toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {g.pairs.length > 0 && (
            <>
              <h3 className="border-t border-chalk/8 px-4 py-2.5 text-[11px] uppercase tracking-wider text-chalk/55">
                Riding them vs taking them on
              </h3>
              <table className="stats w-full text-sm">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-chalk/55">
                    <th className="py-2 pl-4 pr-3 font-semibold">Member</th>
                    <th className="px-3 py-2 text-right font-semibold">Tailing</th>
                    <th className="px-3 py-2 text-right font-semibold">Units</th>
                    <th className="px-3 py-2 text-right font-semibold">Fading</th>
                    <th className="py-2 pl-3 pr-4 text-right font-semibold">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {g.pairs.map((p) => (
                    <tr key={p.name} className="border-t border-chalk/5">
                      <td className="py-2 pl-4 pr-3 font-sans text-chalk">{p.name}</td>
                      <td className="px-3 py-2 text-right text-chalk/80">
                        {p.tailing.decided > 0 ? formatRecord(p.tailing) : "–"}
                      </td>
                      <UnitsCell t={p.tailing} />
                      <td className="px-3 py-2 text-right text-chalk/80">
                        {p.fading.decided > 0 ? formatRecord(p.fading) : "–"}
                      </td>
                      <td className={`py-2 pl-3 pr-4 text-right ${unitsClass(p.fading.units)}`}>
                        {p.fading.units >= 0 ? "+" : ""}
                        {p.fading.units.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <p className="px-4 py-2.5 text-[10.5px] leading-relaxed text-dim">
            Nobody types any of this in. Whoever gets a game and market on the board first is the
            source; anyone behind them on the same side is tailing, on the other side is fading.
            Voided bets are dropped before it is decided — a bet that was taken back cannot hold
            origination.
          </p>
        </section>
      ))}
    </>
  );
}

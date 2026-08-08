"use client";

import { Check, ChevronDown, ChevronUp, Ticket, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { logSlipBets } from "../../app/actions/bets";
import { slipKey, useBetSlip } from "../../lib/bet-slip-store";
import { REASON_TAGS, REASON_TAG_LABELS } from "../../lib/db-types";
import { fmtMoneyline } from "../../lib/slate";

/**
 * Floating bet slip. Selections come from tapping the odds cells on game
 * cards; each one becomes a ledger row (bets action validates + inserts).
 */
export function BetSlip({ seasonId }: { seasonId: number }) {
  const { slip, remove, clear } = useBetSlip();
  const [units, setUnits] = useState<Record<string, string>>({});
  const [reasonTag, setReasonTag] = useState<string>("model_edge");
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);

  // re-open (and drop the "logged" toast) when a fresh selection comes in
  const prevCount = useRef(slip.length);
  useEffect(() => {
    if (slip.length > prevCount.current) {
      setOpen(true);
      setLogged(false);
      setError(null);
    }
    prevCount.current = slip.length;
  }, [slip.length]);

  if (slip.length === 0) {
    return logged ? (
      <div className="fixed bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+0.75rem)] right-4 md:bottom-[max(1rem,env(safe-area-inset-bottom))] z-30">
        <div className="card flex items-center gap-2 px-4 py-2.5 text-sm text-win">
          <Check size={15} strokeWidth={3} aria-hidden />
          Bets logged to your ledger
          <button
            onClick={() => setLogged(false)}
            aria-label="Dismiss"
            className="ml-1 rounded p-0.5 text-dim hover:text-chalk"
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      </div>
    ) : null;
  }

  const unitsFor = (key: string): number => {
    const raw = units[key];
    if (raw === undefined || raw.trim() === "") return 1;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  };
  const totalUnits = slip.reduce((sum, s) => {
    const u = unitsFor(slipKey(s));
    return Number.isFinite(u) ? sum + u : sum;
  }, 0);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const res = await logSlipBets(
        seasonId,
        reasonTag,
        slip.map((s) => ({
          gameId: s.gameId,
          betType: s.betType,
          side: s.side,
          line: s.line,
          odds: s.odds,
          units: unitsFor(slipKey(s)),
          description: s.description,
        })),
      );
      if (!res.ok) {
        setError(res.message ?? "Something went wrong");
      } else {
        clear();
        setUnits({});
        setLogged(true);
      }
    });

  return (
    <div className="fixed bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+0.75rem)] right-4 md:bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 w-[340px] max-w-[calc(100vw-2rem)]">
      <div className="card overflow-hidden shadow-2xl">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
        >
          <Ticket size={15} aria-hidden className="text-accent" />
          <span className="display text-sm text-chalk">Bet slip</span>
          <span className="stat rounded-full bg-accent px-1.5 py-0.5 text-[10.5px] font-bold leading-none text-accent-ink">
            {slip.length}
          </span>
          <span className="ml-auto text-dim">
            {open ? <ChevronDown size={15} aria-hidden /> : <ChevronUp size={15} aria-hidden />}
          </span>
        </button>

        {open && (
          <div className="border-t border-chalk/8">
            <ul className="scroll-thin max-h-[45vh] overflow-y-auto">
              {slip.map((s) => {
                const key = slipKey(s);
                return (
                  <li
                    key={key}
                    className="flex items-center gap-2 border-b border-chalk/6 px-3.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="scorebug truncate text-[14px] leading-tight text-chalk">
                        {s.label}
                        <span className="stat ml-1.5 text-[10.5px] font-normal text-dim">
                          {fmtMoneyline(s.odds)}
                        </span>
                      </p>
                      <p className="stat truncate text-[10.5px] text-dim">{s.matchup}</p>
                    </div>
                    <label className="flex shrink-0 items-center gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-chalk/40">u</span>
                      <input
                        value={units[key] ?? ""}
                        onChange={(e) => setUnits((u) => ({ ...u, [key]: e.target.value }))}
                        placeholder="1"
                        inputMode="decimal"
                        aria-label={`Units for ${s.label}`}
                        className="stat h-7 w-12 rounded-md border border-chalk/12 bg-elev px-1.5 text-right text-xs text-chalk focus:border-accent/60 focus:outline-none"
                      />
                    </label>
                    <button
                      onClick={() => remove(s.gameId, s.betType)}
                      aria-label={`Remove ${s.label} from bet slip`}
                      className="shrink-0 rounded p-1 text-chalk/30 transition-colors hover:text-loss"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-col gap-2 px-3.5 py-3">
              <label className="relative">
                <span className="sr-only">Reason tag</span>
                <select
                  value={reasonTag}
                  onChange={(e) => setReasonTag(e.target.value)}
                  className="h-8 w-full appearance-none rounded-lg border border-chalk/12 bg-elev pl-3 pr-7 text-xs font-medium text-chalk focus:border-accent/60 focus:outline-none"
                >
                  {REASON_TAGS.map((tag) => (
                    <option key={tag} value={tag}>
                      Why: {REASON_TAG_LABELS[tag]}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  aria-hidden
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-dim"
                />
              </label>
              {error && <p className="text-xs text-loss">{error}</p>}
              <div className="flex items-center gap-2">
                <button
                  onClick={clear}
                  disabled={pending}
                  className="h-9 shrink-0 rounded-lg px-3 text-xs font-medium text-dim transition-colors hover:text-chalk disabled:opacity-50"
                >
                  Clear
                </button>
                <button
                  onClick={submit}
                  disabled={pending}
                  className="h-9 flex-1 rounded-lg bg-accent text-sm font-semibold text-accent-ink transition-opacity disabled:opacity-60"
                >
                  {pending
                    ? "Logging…"
                    : `Log ${slip.length} bet${slip.length > 1 ? "s" : ""} · ${totalUnits}u`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

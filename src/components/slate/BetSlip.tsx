"use client";

import { Check, ChevronDown, ChevronUp, Share, Ticket, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { logSlipBets } from "../../app/actions/bets";
import { slipKey, useBetSlip, type SlipSelection } from "../../lib/bet-slip-store";
import { betsChanged } from "../../lib/bets-changed";
import { REASON_TAGS, REASON_TAG_LABELS } from "../../lib/db-types";
import { DEFAULT_TZ, kickHeading } from "../../lib/kick";
import { shareOrCopy } from "../../lib/share-sheet";
import { betSlipText, type SharePick } from "../../lib/share-text";
import { fmtMoneyline } from "../../lib/slate";

/** One logged/pending selection as a shareable line, with its kickoff. */
function toSharePick(s: SlipSelection, units: number, tz: string): SharePick {
  return {
    key: slipKey(s),
    market: "spread",
    side: s.side,
    line: s.line,
    homeAbbr: "",
    awayAbbr: "",
    // A slip line is already written the way a ticket reads; rebuilding it
    // from side + line would only reintroduce the sign bugs `label` avoids.
    text: `${s.label} ${fmtMoneyline(s.odds)}${units === 1 ? "" : ` (${units}u)`} — ${s.matchup}`,
    kickTs: s.kickTs,
    kickLabel: s.kickTs === null ? null : kickHeading(s.kickTs, tz),
  };
}

/**
 * Floating bet slip. Selections come from tapping the odds cells on game
 * cards; each one becomes a ledger row (bets action validates + inserts).
 *
 * Sharing sits here, at the moment a slip exists, rather than only on the
 * ledger three taps away: the point at which someone wants to send their bets
 * to the group chat is the second after placing them. The shared text groups
 * by kickoff, which is how the person reading it decides what to watch.
 */
export function BetSlip({
  seasonId,
  week,
  tz = DEFAULT_TZ,
  demo = false,
}: {
  seasonId: number;
  week: number;
  tz?: string;
  /** `/demo`: the slip fills and confirms, but never reaches the ledger. */
  demo?: boolean;
}) {
  const { slip, remove, clear } = useBetSlip();
  const [units, setUnits] = useState<Record<string, string>>({});
  // A tailed selection knows why it exists, so the slip says so by default —
  // still overridable, since somebody may have had the same side anyway.
  // Derived rather than synced: an explicit choice wins, and until there is
  // one the default follows what is on the slip.
  const [tagChoice, setTagChoice] = useState<string | null>(null);
  const tailedFrom = slip.find((s) => s.tailedFrom !== undefined)?.tailedFrom;
  const reasonTag = tagChoice ?? (tailedFrom === undefined ? "model_edge" : "tail");
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // What was logged, kept so the confirmation can offer to share it — the
  // store is cleared on submit, which is what made "share what I just placed"
  // impossible from here before.
  const [logged, setLogged] = useState<SharePick[] | null>(null);
  const loggedUnits = useRef(0);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date());

  const share = async (bets: SharePick[], totalUnits: number) => {
    const outcome = await shareOrCopy(betSlipText(bets, { day: dayLabel, week, totalUnits }));
    if (outcome === "shared" || outcome === "dismissed") return;
    setShareNote(outcome === "copied" ? "Copied" : "Could not share");
    setTimeout(() => setShareNote(null), 1800);
  };

  // re-open (and drop the "logged" toast) when a fresh selection comes in
  const prevCount = useRef(slip.length);
  useEffect(() => {
    if (slip.length > prevCount.current) {
      setOpen(true);
      setLogged(null);
      setError(null);
    }
    prevCount.current = slip.length;
  }, [slip.length]);

  if (slip.length === 0) {
    return logged ? (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+0.75rem)] right-4 md:bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 max-w-[calc(100vw-2rem)]"
      >
        <div className="card flex items-center gap-2 px-3.5 py-2 text-sm">
          <Check size={15} strokeWidth={3} aria-hidden className="shrink-0 text-win" />
          <span className={demo ? "text-dim" : "text-win"}>
            {logged.length} {logged.length === 1 ? "bet" : "bets"}{" "}
            {/* Short on purpose: the toast is capped at the viewport width and
                a longer sentence wraps out of its own card. */}
            {demo ? "— demo, not saved" : "logged"}
          </span>
          {/* The share offer belongs on the confirmation, not three screens
              away on the ledger: this is the second someone wants to send it. */}
          <button
            onClick={() => void share(logged, loggedUnits.current)}
            className="stat inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-chalk/20 px-2.5 text-xs font-semibold text-chalk hover:border-chalk/50"
          >
            <Share size={13} aria-hidden />
            {shareNote ?? "Share slip"}
          </button>
          <button
            onClick={() => setLogged(null)}
            aria-label="Dismiss"
            className="ml-0.5 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-dim hover:text-chalk"
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
      if (demo) {
        // The slip is worth showing — building one is how a bet gets made here
        // — but there is no season 2026 game 9104 to write it against, and the
        // ledger is append-only. So it confirms and keeps nothing.
        loggedUnits.current = totalUnits;
        setLogged(slip.map((s) => toSharePick(s, unitsFor(slipKey(s)), tz)));
        clear();
        setUnits({});
        setTagChoice(null);
        return;
      }
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
        loggedUnits.current = totalUnits;
        setLogged(slip.map((s) => toSharePick(s, unitsFor(slipKey(s)), tz)));
        clear();
        setUnits({});
        setTagChoice(null);
        // the cards behind the slip are holding a slate that predates these
        // rows; tell them so rather than making the user wait for a poll
        betsChanged();
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
                        className="stat h-11 w-12 rounded-md border border-chalk/12 bg-elev px-1.5 text-right text-xs text-chalk focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                      />
                    </label>
                    <button
                      onClick={() => remove(s.gameId, s.betType)}
                      aria-label={`Remove ${s.label} from bet slip`}
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-chalk/30 transition-colors hover:text-loss"
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
                  onChange={(e) => setTagChoice(e.target.value)}
                  className="h-8 w-full appearance-none rounded-lg border border-chalk/12 bg-elev pl-3 pr-7 text-xs font-medium text-chalk focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
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
                {/* Shareable before it is logged, too: plenty of slips get
                    texted round for opinions and never make the ledger. */}
                <button
                  onClick={() =>
                    void share(
                      slip.map((s) => toSharePick(s, unitsFor(slipKey(s)), tz)),
                      totalUnits,
                    )
                  }
                  aria-label="Share this slip"
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-chalk/15 px-2.5 text-xs font-medium text-dim transition-colors hover:border-chalk/40 hover:text-chalk"
                >
                  <Share size={13} aria-hidden />
                  {shareNote ?? "Share"}
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

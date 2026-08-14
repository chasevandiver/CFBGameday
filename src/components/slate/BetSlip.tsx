"use client";

import { Check, ChevronDown, ChevronUp, Share, Ticket, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { logSlipBets } from "../../app/actions/bets";
import { slipKey, useBetSlip, type SlipSelection } from "../../lib/bet-slip-store";
import { betsChanged } from "../../lib/bets-changed";
import { DEFAULT_TZ, kickHeading } from "../../lib/kick";
import { slipCardPayload } from "../../lib/share-card-build";
import { shareOrCopy } from "../../lib/share-sheet";
import { betSlipText, type SharePick } from "../../lib/share-text";
import { fmtMoneyline } from "../../lib/slate";
import { ConfidencePicker } from "../ConfidencePicker";
import { ShareImageButton } from "../ShareImageButton";

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
  displayName = "",
  demo = false,
}: {
  seasonId: number;
  week: number;
  tz?: string;
  /** Titles the image share: "<display_name> Bets". */
  displayName?: string;
  /** `/demo`: the slip fills and confirms, but never reaches the ledger. */
  demo?: boolean;
}) {
  const { slip, remove, setTier, clear } = useBetSlip();
  const [units, setUnits] = useState<Record<string, string>>({});
  // A tailed selection knows why it exists, so the slip says so by default —
  // still overridable, since somebody may have had the same side anyway.
  // Derived rather than synced: an explicit choice wins, and until there is
  // one the default follows what is on the slip.
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // What was logged, kept so the confirmation can offer to share it — the
  // store is cleared on submit, which is what made "share what I just placed"
  // impossible from here before.
  const [logged, setLogged] = useState<SharePick[] | null>(null);
  const loggedUnits = useRef(0);
  // The image share needs the whole payload, not the text lines, and the store
  // is cleared on submit — so it is captured for the toast the same way.
  // State rather than a ref, because unlike `loggedUnits` it is read during
  // render: a ref read there would not re-render when the toast appears.
  const [loggedCard, setLoggedCard] = useState<ReturnType<typeof slipCardPayload> | null>(null);
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
        {/* A panel for the same reason the slip is (UX-38): this replaces it in
            the same fixed slot over the same scrolling slate. It was missed on
            the first pass and kept the exact transparency that was reported. */}
        <div className="panel flex items-center gap-2 px-3.5 py-2 text-sm">
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
          <ShareImageButton
            payload={loggedCard}
            filename="cfb-slate-bets.png"
            label="Image"
            className="stat inline-flex min-h-11 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-lg border border-chalk/20 px-2.5 text-xs font-semibold text-chalk hover:border-chalk/50 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          />
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

  const cardPayload = slipCardPayload(slip, unitsFor, { displayName, week, day: dayLabel });

  const submit = () =>
    startTransition(async () => {
      setError(null);
      if (demo) {
        // The slip is worth showing — building one is how a bet gets made here
        // — but there is no season 2026 game 9104 to write it against, and the
        // ledger is append-only. So it confirms and keeps nothing.
        loggedUnits.current = totalUnits;
        setLoggedCard(cardPayload);
        setLogged(slip.map((s) => toSharePick(s, unitsFor(slipKey(s)), tz)));
        clear();
        setUnits({});
        return;
      }
      const res = await logSlipBets(
        seasonId,
        slip.map((s) => ({
          gameId: s.gameId,
          betType: s.betType,
          side: s.side,
          line: s.line,
          odds: s.odds,
          units: unitsFor(slipKey(s)),
          description: s.description,
          confidence: s.tier,
        })),
      );
      if (!res.ok) {
        setError(res.message ?? "Something went wrong");
      } else {
        loggedUnits.current = totalUnits;
        setLoggedCard(cardPayload);
        setLogged(slip.map((s) => toSharePick(s, unitsFor(slipKey(s)), tz)));
        clear();
        setUnits({});
        // the cards behind the slip are holding a slate that predates these
        // rows; tell them so rather than making the user wait for a poll
        betsChanged();
      }
    });

  return (
    <div className="fixed bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+0.75rem)] right-4 md:bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 w-[340px] max-w-[calc(100vw-2rem)]">
      {/* UX-38: `.panel`, not `.card`. The slip is the one card-shaped thing
          that floats over the scrolling slate with no aura behind it and no
          blur, so at --glass-surface's 80% the game cards underneath showed
          through and the 11px type on it was unreadable. */}
      <div className="panel overflow-hidden">
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
                  <li key={key} className="border-b border-chalk/6 px-3.5 py-2">
                   <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="scorebug truncate text-[14px] leading-tight text-chalk">
                        {s.label}
                        {/* The price is a value, not a label — it belongs on
                            --text like the number beside it, and at 11px it is
                            on the same step as the rest of the slip's data
                            (UX-38). */}
                        <span className="stat ml-1.5 text-[11px] font-normal text-chalk/70">
                          {fmtMoneyline(s.odds)}
                        </span>
                      </p>
                      <p className="stat truncate text-[11px] text-chalk/60">{s.matchup}</p>
                    </div>
                    <label className="flex shrink-0 items-center gap-1">
                      <span className="text-[10.5px] uppercase tracking-wide text-chalk/60">u</span>
                      <input
                        value={units[key] ?? ""}
                        onChange={(e) => setUnits((u) => ({ ...u, [key]: e.target.value }))}
                        placeholder="1"
                        inputMode="decimal"
                        aria-label={`Units for ${s.label}`}
                        className="stat h-11 w-12 rounded-md border border-chalk/20 bg-elev px-1.5 text-right text-sm text-chalk focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                      />
                    </label>
                    <button
                      onClick={() => remove(s.gameId, s.betType)}
                      aria-label={`Remove ${s.label} from bet slip`}
                      /* /55, not /30. Against the panel's now-opaque face /30
                         computes 2.5:1 dark and 1.9:1 light — under 1.4.11's
                         3:1 for a non-text control. Raising the surface's
                         opacity is what exposed this. */
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-chalk/55 transition-colors hover:text-loss"
                    >
                      <X size={14} aria-hidden />
                    </button>
                   </div>
                    {/* Its own line: six labels as long as "Bet of the Century"
                        cannot share a 340px row with the stake and the remove
                        target and still clear 44px. */}
                    <ConfidencePicker
                      value={s.tier}
                      onChange={(tier) => setTier(s.gameId, s.betType, tier)}
                      label={`Confidence for ${s.label}`}
                      className="stat mt-1.5 h-11 w-full rounded-md border border-chalk/20 bg-elev px-2 text-xs text-chalk focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                    />
                  </li>
                );
              })}
            </ul>

            {/* The "Why" picker used to sit here (LEDGER-1). It asked for a
                self-reported reason tag on every slip, and two of its eight
                values — tail and fade — are facts the database already knows:
                `src/lib/tailing.ts` derives them from who got their money down
                first. The ledger's audit is rebuilt on that instead. */}
            <div className="flex flex-col gap-2 px-3.5 py-3">
              {/* role=alert: a slip that silently fails to log is the one
                  failure a screen-reader user most needs told about. */}
              {error && (
                <p role="alert" className="text-xs text-loss">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={clear}
                  disabled={pending}
                  className="h-11 shrink-0 rounded-lg px-3 text-xs font-medium text-dim transition-colors hover:text-chalk disabled:opacity-50"
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
                  /* The visible word is "Text", so the accessible name has to
                     start with it — a voice-control user saying "Text" got
                     nothing when this was "Share this slip" (2.5.3). */
                  aria-label="Text this slip"
                  className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-chalk/15 px-2.5 text-xs font-medium text-dim transition-colors hover:border-chalk/40 hover:text-chalk"
                >
                  <Share size={13} aria-hidden />
                  {shareNote ?? "Text"}
                </button>
                {/* The second share: the same slip as a card. */}
                <ShareImageButton
                  payload={cardPayload}
                  filename="cfb-slate-bets.png"
                  label="Image"
                  className="stat flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-chalk/15 px-2.5 text-xs font-medium text-dim transition-colors hover:border-chalk/40 hover:text-chalk disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                />
              </div>
              {/* Full width and last, so the primary action sits lowest and
                  widest — the thumb zone rule in docs/DESIGN.md. */}
              <button
                onClick={submit}
                disabled={pending}
                className="h-11 w-full rounded-lg bg-accent text-sm font-semibold text-accent-ink transition-opacity disabled:opacity-60"
              >
                {pending
                  ? "Logging…"
                  : `Log ${slip.length} bet${slip.length > 1 ? "s" : ""} · ${totalUnits}u`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

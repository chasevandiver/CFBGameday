"use client";

import { useRef, useState, useTransition } from "react";
import { logBet } from "../app/actions/bets";
import {
  BET_TYPES,
  BET_TYPE_LABELS,
  CONFIDENCE_TIERS,
  CONFIDENCE_TIER_LABELS,
  TEAM_SIDED,
  TOTAL_SIDED,
} from "../lib/db-types";

export interface BetFormGame {
  id: number;
  label: string;
  homeAbbr: string;
  awayAbbr: string;
}

/**
 * Manual ledger entry with real labels — the old form was placeholder-only
 * (labels vanish the moment you type; classic form a11y failure, audit §17).
 */
export function BetForm({
  seasonId,
  games = [],
  forUserId = null,
}: {
  seasonId: number;
  games?: BetFormGame[];
  /** 0083: log as this member of a betting group you run, not as yourself. */
  forUserId?: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [betType, setBetType] = useState("spread");
  const [gameId, setGameId] = useState("");

  function submit(formData: FormData) {
    startTransition(async () => {
      setMessage(null);
      const res = await logBet(formData);
      if (!res.ok) setMessage(res.message ?? "Something went wrong");
      else {
        formRef.current?.reset();
        setBetType("spread");
        setGameId("");
        setMessage("Logged ✓");
      }
    });
  }

  const input =
    "w-full rounded-lg border border-chalk/12 bg-elev px-3 py-2 text-sm text-chalk placeholder:text-chalk/35 focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

  const game = games.find((g) => String(g.id) === gameId) ?? null;
  const sideOptions: Array<[string, string]> = TEAM_SIDED.has(betType)
    ? [
        ["away", game ? game.awayAbbr : "Away"],
        ["home", game ? game.homeAbbr : "Home"],
      ]
    : TOTAL_SIDED.has(betType)
      ? [
          ["over", "Over"],
          ["under", "Under"],
        ]
      : [];

  return (
    <form ref={formRef} action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="season_id" value={seasonId} />
      {forUserId && <input type="hidden" name="for_user" value={forUserId} />}

      <Field label="Bet" htmlFor="bet-description">
        <input
          id="bet-description"
          name="description"
          required
          placeholder="Michigan -3.5 vs Ohio State"
          className={input}
        />
      </Field>

      {games.length > 0 && (
        <Field label="Game" htmlFor="bet-game" hint="linking enables auto-grading + live tracking">
          <select
            id="bet-game"
            name="game_id"
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
            className={input}
          >
            <option value="">No game — future / other</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Type" htmlFor="bet-type">
          <select
            id="bet-type"
            name="bet_type"
            value={betType}
            onChange={(e) => setBetType(e.target.value)}
            className={input}
          >
            {BET_TYPES.map((v) => (
              <option key={v} value={v}>
                {BET_TYPE_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>
        {sideOptions.length > 0 && (
          <Field label="Side" htmlFor="bet-side">
            <select id="bet-side" name="side" className={input} defaultValue="">
              <option value="">Side…</option>
              {sideOptions.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {betType === "team_total" && (
          // R2-A4: the subject of a team total, structured so the grader can
          // settle it — before 0055 the team lived only in the description.
          <Field label="Whose total" htmlFor="bet-team-side">
            <select id="bet-team-side" name="team_side" className={input} defaultValue="">
              <option value="">Team…</option>
              <option value="away">{game ? game.awayAbbr : "Away"}</option>
              <option value="home">{game ? game.homeAbbr : "Home"}</option>
            </select>
          </Field>
        )}
        <Field label="Line" htmlFor="bet-line" hint="as your ticket reads">
          <input
            id="bet-line"
            name="line_taken"
            inputMode="decimal"
            pattern="-?[0-9]+(\.[05])?"
            title="The number your side holds, half-point increments — e.g. +6.5 for the dog, -3.5 for the favorite, 48.5 for a total"
            placeholder="-3.5"
            className={input}
          />
        </Field>
        <Field label="Odds" htmlFor="bet-odds">
          <input
            id="bet-odds"
            name="odds"
            inputMode="numeric"
            pattern="[+-]?[0-9]{3,4}"
            title="American odds, e.g. -110 or +145"
            placeholder="-110"
            defaultValue={-110}
            className={input}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Units" htmlFor="bet-units">
          <input
            id="bet-units"
            name="units"
            required
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]+)?"
            title="Units staked, e.g. 1 or 0.5"
            placeholder="1"
            className={input}
          />
        </Field>
        {/* The required "Why" reason-tag picker stood here (LEDGER-1). Two of
            its eight values, tail and fade, are facts the database already
            knows — `src/lib/tailing.ts` derives them from arrival order — and
            the other six were a self-report standing between a person and
            logging a bet. The ledger's audit is rebuilt on the derived
            relation, which answers the same question without asking it. */}
        {/* Conviction, which is a different thing from reason and is the one
            worth keeping: how strongly, not why. Defaults to the neutral rung
            so the field is skippable — it only earns its place on the card
            when someone reaches for it. */}
        <Field label="Confidence" htmlFor="bet-confidence">
          <select
            id="bet-confidence"
            name="confidence"
            className={input}
            defaultValue="bet"
          >
            {[...CONFIDENCE_TIERS].reverse().map((tier) => (
              <option key={tier} value={tier}>
                {CONFIDENCE_TIER_LABELS[tier]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Book" htmlFor="bet-book" hint="optional">
          <input id="bet-book" name="book" placeholder="DK, FD…" className={input} />
        </Field>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-opacity disabled:opacity-60"
      >
        {pending ? "Logging…" : "Log bet"}
      </button>
      {message && (
        <p className={`text-xs ${message === "Logged ✓" ? "text-win" : "text-loss"}`}>{message}</p>
      )}
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-[10.5px] font-semibold uppercase tracking-wider text-chalk/55"
      >
        {label}
        {hint && <span className="ml-1.5 font-normal normal-case tracking-normal text-chalk/40">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

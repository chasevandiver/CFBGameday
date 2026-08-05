"use client";

import { useRef, useState, useTransition } from "react";
import { logBet } from "../app/actions/bets";
import { REASON_TAGS, REASON_TAG_LABELS } from "../lib/db-types";

const BET_TYPES = [
  ["spread", "Spread"],
  ["total", "Total"],
  ["moneyline", "Moneyline"],
  ["team_total", "Team total"],
  ["first_half", "1st half"],
  ["future", "Future"],
] as const;

/** Sides the grader and live tracker can key on, per bet type. */
const TEAM_SIDED = new Set(["spread", "moneyline", "first_half"]);
const TOTAL_SIDED = new Set(["total", "team_total"]);

export interface BetFormGame {
  id: number;
  label: string;
  homeAbbr: string;
  awayAbbr: string;
}

export function BetForm({ seasonId, games = [] }: { seasonId: number; games?: BetFormGame[] }) {
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
      }
    });
  }

  const input =
    "rounded border border-chalk/25 bg-field-deep px-3 py-2 text-sm text-chalk placeholder:text-chalk/40 focus:border-gold focus:outline-none";

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
      <input
        name="description"
        required
        placeholder="Michigan -3.5 vs Ohio State"
        className={input}
      />
      {games.length > 0 && (
        <select
          name="game_id"
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          className={input}
          aria-label="Game (links the bet for grading and live tracking)"
        >
          <option value="">No game — future / other</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <select
          name="bet_type"
          value={betType}
          onChange={(e) => setBetType(e.target.value)}
          className={input}
        >
          {BET_TYPES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        {sideOptions.length > 0 && (
          <select name="side" className={input} defaultValue="" aria-label="Side">
            <option value="">Side…</option>
            {sideOptions.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        )}
        <input name="line_taken" inputMode="decimal" placeholder="Line (-3.5)" className={input} />
        <input
          name="odds"
          inputMode="numeric"
          placeholder="Odds (-110)"
          defaultValue={-110}
          className={input}
        />
        <input
          name="units"
          required
          inputMode="decimal"
          placeholder="Units"
          className={input}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <select name="reason_tag" required className={input} defaultValue="">
          <option value="" disabled>
            Reason tag…
          </option>
          {REASON_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {REASON_TAG_LABELS[tag]}
            </option>
          ))}
        </select>
        <input name="book" placeholder="Book (optional)" className={input} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-gold px-4 py-2 text-sm font-semibold text-field-deep disabled:opacity-60"
      >
        {pending ? "Logging…" : "Log bet"}
      </button>
      <p className="text-xs text-chalk/40">
        Linking a game lets Sunday grading and the live scoreboard track this bet automatically.
      </p>
      {message && <p className="text-xs text-flag">{message}</p>}
    </form>
  );
}

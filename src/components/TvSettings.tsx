"use client";

import { Check, Copy, Tv } from "lucide-react";
import { useState } from "react";
import type { FantasyData } from "../lib/fantasy";

/**
 * Your TV links (TV-2): the /tv overlay pages with your calendar key on them,
 * so the Fire TV overlay can show which games you're on without signing in.
 * Same key as the calendar card, so that card's Rotate resets these too.
 *
 * TV-13: an ESPN fantasy league can ride along. Pick it here and every copied
 * link carries `&ffl=&fteam=` with the key, so nobody hand-edits a URL (the
 * first try lost the key and with it every bet colour).
 */
const LINKS = [
  { label: "Game cards", path: "/tv/cards" },
  { label: "Ticker strip", path: "/tv/ticker" },
  { label: "Corner scoreboard", path: "/tv/corner" },
] as const;

type Team = { id: number; name: string };

export function TvSettings({ token }: { token: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [league, setLeague] = useState("");
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [team, setTeam] = useState("");
  const [lookup, setLookup] = useState<"idle" | "busy" | "error">("idle");

  const fantasy = league && team ? `&ffl=${league}&fteam=${team}` : "";
  const link = (path: string) => `${window.location.origin}${path}?k=${token}${fantasy}`;

  const copy = async (path: string) => {
    try {
      await navigator.clipboard.writeText(link(path));
      setCopied(path);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard can be denied; the visible path below is the fallback.
    }
  };

  const findTeams = async () => {
    const id = league.trim();
    if (!/^\d+$/.test(id)) {
      setLookup("error");
      return;
    }
    setLookup("busy");
    try {
      const res = await fetch(`/api/fantasy?league=${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as FantasyData;
      const all = new Map<number, string>();
      for (const m of data.matchups) {
        all.set(m.a.teamId, m.a.name);
        all.set(m.b.teamId, m.b.name);
      }
      setTeams(
        [...all]
          .map(([tid, name]) => ({ id: tid, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setTeam("");
      setLookup("idle");
    } catch {
      setTeams(null);
      setLookup("error");
    }
  };

  return (
    <section className="card mt-4 p-4">
      <div className="mb-1 flex items-center gap-2">
        <Tv className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="text-sm text-accent">On your TV</h2>
      </div>
      <p className="mb-3 text-xs text-dim">
        Your own links for the TV Overlay app. Games you have a bet or pick on light up green when
        you&rsquo;re covering and red when you&rsquo;re not. Paste one into the overlay&rsquo;s
        &ldquo;Any page&rdquo; box and save it. Rotating your calendar link resets these too.
      </p>

      <div className="mb-3 rounded-lg bg-elev p-3 ring-1 ring-inset ring-chalk/8">
        <p className="mb-2 text-xs text-chalk">
          ESPN fantasy <span className="text-dim">(optional, public leagues)</span>
        </p>
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            value={league}
            onChange={(e) => {
              setLeague(e.target.value.replace(/\D/g, ""));
              setTeams(null);
              setTeam("");
            }}
            placeholder="League ID"
            aria-label="ESPN league ID"
            className="min-h-9 min-w-0 flex-1 rounded-lg bg-surface px-3 text-sm text-chalk ring-1 ring-inset ring-chalk/10"
          />
          <button
            type="button"
            onClick={() => void findTeams()}
            disabled={!league || lookup === "busy"}
            className="min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold text-chalk ring-1 ring-inset ring-chalk/15 disabled:opacity-50"
          >
            {lookup === "busy" ? "Finding…" : "Find teams"}
          </button>
        </div>
        {lookup === "error" && (
          <p className="mt-2 text-xs text-loss">
            Couldn&rsquo;t read that league. Check the ID, and that the league is public.
          </p>
        )}
        {teams && (
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            aria-label="Your fantasy team"
            className="mt-2 min-h-9 w-full rounded-lg bg-surface px-3 text-sm text-chalk ring-1 ring-inset ring-chalk/10"
          >
            <option value="">Which team is yours?</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {fantasy && (
          <p className="mt-2 text-xs text-dim">Copied links now include your fantasy matchup.</p>
        )}
      </div>

      <ul className="space-y-2">
        {LINKS.map(({ label, path }) => (
          <li
            key={path}
            className="flex items-center justify-between gap-3 rounded-lg bg-elev px-3 py-2 ring-1 ring-inset ring-chalk/8"
          >
            <span className="min-w-0">
              <span className="block text-sm text-chalk">{label}</span>
              <span className="stat block truncate text-[11px] text-chalk/60">
                {path}?k={token.slice(0, 8)}…{fantasy ? " + fantasy" : ""}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void copy(path)}
              className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-ink"
            >
              {copied === path ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              {copied === path ? "Copied" : "Copy"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

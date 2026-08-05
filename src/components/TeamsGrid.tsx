"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface TeamCard {
  id: number;
  school: string;
  mascot: string | null;
  conference: string | null;
  logo: string | null;
  rating: number;
  rank: number;
  /** Human-poll rank shown as a pip; ordering stays by model rating */
  pollRank: number | null;
  poll: string | null;
}

export function TeamsGrid({ teams }: { teams: TeamCard[] }) {
  const [conference, setConference] = useState<string | null>(null);
  const conferences = useMemo(
    () =>
      [...new Set(teams.map((t) => t.conference).filter((c): c is string => c !== null))].sort(),
    [teams],
  );
  const visible = conference ? teams.filter((t) => t.conference === conference) : teams;

  return (
    <div className="flex flex-col gap-4">
      <div className="scroll-thin flex gap-1.5 overflow-x-auto pb-1">
        <Chip label="All" active={conference === null} onClick={() => setConference(null)} />
        {conferences.map((c) => (
          <Chip key={c} label={c} active={conference === c} onClick={() => setConference(c)} />
        ))}
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((t) => (
          <li key={t.id}>
            <Link
              href={`/team/${t.id}`}
              className="card card-hover flex items-center gap-3 px-3 py-2.5"
            >
              <span className="stat w-8 shrink-0 text-right text-sm text-dim">{t.rank}</span>
              {t.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.logo} alt="" className="h-7 w-7 shrink-0" loading="lazy" />
              ) : (
                <span className="h-7 w-7 shrink-0 rounded-full bg-elev" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate font-medium">{t.school}</span>
                  {t.pollRank !== null && t.poll && (
                    <span className="stat shrink-0 text-[10px] text-dim" title={`${t.poll} rank`}>
                      #{t.pollRank} {t.poll}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-dim">{t.conference ?? "—"}</span>
              </span>
              <span
                className={`stat shrink-0 text-sm font-semibold ${t.rating > 0 ? "text-win" : t.rating < 0 ? "text-dim" : ""}`}
              >
                {t.rating > 0 ? "+" : ""}
                {t.rating.toFixed(1)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-accent bg-accent/15 text-accent"
          : "border-chalk/20 text-dim hover:border-chalk/50 hover:text-chalk"
      }`}
    >
      {label}
    </button>
  );
}

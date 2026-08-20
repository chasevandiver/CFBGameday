"use client";

import { Ticket } from "lucide-react";
import { funOn, useFunPrefs } from "../lib/fun-mode";
import type { WeekStub } from "../lib/stubs";

/**
 * The stub shelf (FUN-7): every graded week of picks prints a ticket stub —
 * the season as a drawer of torn tickets. Derived on read (`lib/stubs.ts`);
 * a re-grade reprints. Fun Mode only, viewer's own picks only.
 */
export function TicketStubs({ stubs, year }: { stubs: WeekStub[]; year: number }) {
  const [prefs] = useFunPrefs();
  if (!funOn(prefs, "stubs") || stubs.length === 0) return null;

  return (
    <section className="card mt-6 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm text-accent">
        <Ticket size={14} aria-hidden />
        Ticket stubs
      </h2>
      <p className="text-xs text-dim">One per graded week of picks. The season, in a drawer.</p>
      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {stubs.map((s) => (
          <li key={s.week} className="fun-stub">
            <span className="stat block text-[9px] uppercase tracking-[0.16em] text-dim">
              The Slate · {year}
            </span>
            <span className="stat mt-1 block text-lg font-bold leading-none text-chalk">
              Wk {s.week}
            </span>
            <span className="stat mt-1 block text-xs text-dim">
              {s.w}–{s.l}
              {s.p > 0 ? `–${s.p}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

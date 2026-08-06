"use client";

import { useRef, useState, useTransition } from "react";
import {
  addAdjustment,
  confirmAdjustment,
  removeAdjustment,
} from "../app/actions/adjustments";

export interface AdjustmentView {
  id: number;
  teamId: number;
  school: string;
  points: number;
  reason: string;
  source: string;
  confirmed: boolean;
}

export function AdjustmentsPanel({
  teams,
  adjustments,
}: {
  teams: Array<{ id: number; school: string }>;
  adjustments: AdjustmentView[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const res = await addAdjustment(
        Number(formData.get("team_id")),
        Number(formData.get("points")),
        String(formData.get("reason") ?? ""),
      );
      if (res.ok) formRef.current?.reset();
      else setError(res.message ?? "Something went wrong");
    });
  }

  function act(fn: (id: number) => Promise<{ ok: boolean; message?: string }>, id: number) {
    startTransition(async () => {
      setError(null);
      const res = await fn(id);
      if (!res.ok) setError(res.message ?? "Something went wrong");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <form ref={formRef} action={submit} className="flex flex-wrap gap-2">
        <select
          name="team_id"
          required
          defaultValue=""
          className="min-w-40 flex-1 rounded-lg border border-chalk/25 bg-elev px-3 py-2 text-sm text-chalk focus:border-accent focus:outline-none"
        >
          <option value="" disabled>
            Team…
          </option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.school}
            </option>
          ))}
        </select>
        <input
          name="points"
          type="number"
          step="0.5"
          min="-14"
          max="14"
          required
          placeholder="±pts"
          className="w-24 rounded-lg border border-chalk/25 bg-elev px-3 py-2 text-sm text-chalk placeholder:text-chalk/40 focus:border-accent focus:outline-none"
        />
        <input
          name="reason"
          type="text"
          required
          placeholder="Reason (QB out, suspension…)"
          className="min-w-52 flex-[2] rounded-lg border border-chalk/25 bg-elev px-3 py-2 text-sm text-chalk placeholder:text-chalk/40 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : "Apply"}
        </button>
      </form>
      {error && <p className="text-xs text-loss">{error}</p>}

      {adjustments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {adjustments.map((a) => (
            <li key={a.id} className="stat flex items-center gap-3 text-xs">
              <span className="w-36 shrink-0 truncate text-chalk/80">{a.school}</span>
              <span
                className={`w-12 shrink-0 text-right font-semibold ${a.points > 0 ? "text-accent" : "text-loss"}`}
              >
                {a.points > 0 ? "+" : ""}
                {a.points.toFixed(1)}
              </span>
              <span className="min-w-0 flex-1 truncate font-sans text-chalk/60">{a.reason}</span>
              {a.confirmed ? (
                <span className="shrink-0 text-chalk/40">active</span>
              ) : (
                <button
                  onClick={() => act(confirmAdjustment, a.id)}
                  disabled={pending}
                  className="shrink-0 rounded-lg border border-accent/50 px-2 py-0.5 text-accent hover:bg-accent/10 disabled:opacity-60"
                >
                  Confirm
                </button>
              )}
              <button
                onClick={() => act(removeAdjustment, a.id)}
                disabled={pending}
                className="shrink-0 rounded-lg border border-chalk/25 px-2 py-0.5 text-chalk/60 hover:border-loss hover:text-loss disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

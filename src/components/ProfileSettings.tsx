"use client";

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toggleFavoriteTeam, updateDisplayName, updateTimezone } from "../app/actions/profile";
import { createClient } from "../lib/supabase/client";
import { TIMEZONES } from "../lib/kick";

export interface FavTeam {
  id: number;
  school: string;
  conference: string | null;
  logo: string | null;
}

export function ProfileSettings({
  displayName,
  favoriteIds,
  teams,
  timezone,
}: {
  displayName: string;
  favoriteIds: number[];
  teams: FavTeam[];
  timezone: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const favorites = useMemo(
    () => teams.filter((t) => favoriteIds.includes(t.id)),
    [teams, favoriteIds],
  );
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return teams
      .filter((t) => t.school.toLowerCase().includes(q) && !favoriteIds.includes(t.id))
      .slice(0, 8);
  }, [teams, query, favoriteIds]);

  const saveName = (formData: FormData) =>
    startTransition(async () => {
      setMessage(null);
      const res = await updateDisplayName(formData);
      setMessage(res.ok ? "Saved" : (res.message ?? "Something went wrong"));
    });

  const saveTz = (formData: FormData) =>
    startTransition(async () => {
      setMessage(null);
      const res = await updateTimezone(formData);
      setMessage(res.ok ? "Saved" : (res.message ?? "Something went wrong"));
      router.refresh();
    });

  const toggle = (teamId: number) =>
    startTransition(async () => {
      setMessage(null);
      const res = await toggleFavoriteTeam(teamId);
      if (!res.ok) setMessage(res.message ?? "Something went wrong");
      setQuery("");
    });

  const input =
    "rounded-lg border border-chalk/12 bg-elev px-3 py-2 text-sm text-chalk placeholder:text-chalk/35 focus:border-accent/60 focus:outline-none";

  return (
    <div className="flex flex-col gap-6">
      <section className="card p-4">
        <h2 className="mb-3 text-sm text-accent">Display name</h2>
        <form ref={formRef} action={saveName} className="flex gap-2">
          <input
            name="display_name"
            defaultValue={displayName}
            required
            minLength={2}
            maxLength={24}
            aria-label="Display name"
            className={`flex-1 ${input}`}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
          >
            Save
          </button>
        </form>
        <p className="mt-2 text-xs text-dim">This is the name on your group leaderboards.</p>
      </section>

      {/* UX-25. Server-side rather than sniffed from the browser: kickoff
          labels and the ledger's "today" are rendered on the server, so a
          client-side guess cannot reach them. Submits on change — a Save
          button beside a single select is a step nobody needs. */}
      <section className="card p-4">
        <h2 className="mb-1 text-sm text-accent">Time zone</h2>
        <p className="mb-3 text-xs text-dim">
          Kickoff times and the ledger&apos;s &ldquo;today&rdquo; use this. Central if you
          never touch it.
        </p>
        <form action={saveTz}>
          <select
            name="timezone"
            defaultValue={timezone}
            aria-label="Time zone"
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={`min-h-11 w-full ${input}`}
          >
            {TIMEZONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </form>
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-sm text-accent">Favorite teams</h2>
        <p className="mb-3 text-xs text-dim">
          Favorites pin to the top of the slate on every device you sign in on (up to 12).
        </p>
        {favorites.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-1.5">
            {favorites.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => toggle(t.id)}
                  disabled={pending}
                  title={`Remove ${t.school}`}
                  className="flex items-center gap-1.5 rounded-full border border-accent/50 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:border-loss hover:text-loss disabled:opacity-60"
                >
                  {t.logo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.logo} alt="" className="h-4 w-4" />
                  )}
                  {t.school}
                  <span aria-hidden>×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teams to add…"
          aria-label="Search teams"
          className={`w-full ${input}`}
        />
        {results.length > 0 && (
          <ul className="mt-2 flex flex-col overflow-hidden rounded-lg border border-chalk/10">
            {results.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => toggle(t.id)}
                  disabled={pending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-chalk transition-colors hover:bg-elev disabled:opacity-60"
                >
                  <Star size={12} aria-hidden className="text-accent" />
                  {t.logo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.logo} alt="" className="h-4 w-4" />
                  )}
                  <span className="flex-1 truncate">{t.school}</span>
                  <span className="text-xs text-dim">{t.conference}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card flex items-center justify-between p-4">
        <div>
          <h2 className="text-sm text-accent">Session</h2>
          <p className="mt-1 text-xs text-dim">Signed in on this device until you sign out.</p>
        </div>
        <button
          onClick={() => {
            void createClient()
              .auth.signOut()
              .then(() => {
                // The hub renders signed out, so this lands somewhere real
                // rather than bouncing off /me's auth redirect.
                router.push("/");
                router.refresh();
              });
          }}
          className="rounded-lg border border-chalk/12 px-3 py-2 text-sm font-medium text-dim transition-colors hover:border-loss hover:text-loss"
        >
          Sign out
        </button>
      </section>

      {message && <p className="text-xs text-dim">{message}</p>}
    </div>
  );
}

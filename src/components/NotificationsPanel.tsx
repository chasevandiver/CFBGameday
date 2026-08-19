"use client";

import { useState } from "react";
import { sendAdHocNotification, updateNotificationSetting } from "../app/actions/push";

/**
 * The admin console's Notifications section (docs/STATUS.md PUSH-7).
 *
 * Three parts, and the third is the one that matters: compose-and-send so an
 * announcement never needs a deploy, the send log so "did it fire?" is a page
 * rather than a question, and a switch per trigger so retuning lead time or
 * copy is a form field rather than a code change.
 */

export interface TriggerSetting {
  kind: string;
  enabled: boolean;
  lead_minutes: number;
  title: string;
  body: string;
}

export interface SendRow {
  id: number;
  kind: string;
  subject: string;
  title: string;
  status: string;
  detail: string | null;
  sent_at: string;
  who: string;
}

export interface AudienceOption {
  value: string;
  label: string;
}

/** Which `{{tokens}}` each trigger's templates can use, shown beside the field. */
const TOKENS: Record<string, string> = {
  picks_due: "{{count}} {{group}} {{kickoff}}",
  log_bets: "{{group}} {{kickoff}}",
  bad_beat: "{{team}} {{home}} {{away}} {{detail}}",
  added_to_group: "{{group}} {{admin}}",
  watchdog: "{{jobs}}",
};

const LABELS: Record<string, string> = {
  picks_due: "Picks closing",
  log_bets: "Log your bets",
  bad_beat: "Bad beats",
  added_to_group: "Added to a group",
  watchdog: "A job went silent",
  admin: "Ad-hoc and tests",
};

export function NotificationsPanel({
  settings,
  sends,
  audiences,
  configured,
}: {
  settings: TriggerSetting[];
  sends: SendRow[];
  audiences: AudienceOption[];
  configured: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function compose(formData: FormData) {
    setBusy(true);
    const result = await sendAdHocNotification(formData);
    setNote(result.message ?? (result.ok ? "Sent" : "Failed"));
    setBusy(false);
  }

  async function saveTrigger(formData: FormData) {
    setBusy(true);
    const result = await updateNotificationSetting(formData);
    setNote(result.message ?? (result.ok ? "Saved" : "Failed"));
    setBusy(false);
  }

  return (
    <section className="card mb-4 p-4">
      <h2 className="mb-1 text-sm text-accent">Notifications</h2>

      {!configured && (
        <p className="mb-3 rounded-lg border border-edge/40 px-3 py-2 text-xs text-edge">
          Push keys are not set on the server. Add <code>VAPID_PRIVATE_KEY</code> and{" "}
          <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> — nothing below will send until then.
        </p>
      )}

      {/* ---- compose ---- */}
      <form action={compose} className="mb-5 space-y-2">
        <p className="text-xs text-dim">Send something now</p>
        <input
          name="title"
          required
          maxLength={120}
          placeholder="Title"
          aria-label="Notification title"
          className="h-9 w-full rounded-lg border border-chalk/12 bg-elev px-3 text-sm text-chalk placeholder:text-chalk/35 focus:border-accent/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />
        <input
          name="body"
          maxLength={300}
          placeholder="Body"
          aria-label="Notification body"
          className="h-9 w-full rounded-lg border border-chalk/12 bg-elev px-3 text-sm text-chalk placeholder:text-chalk/35 focus:border-accent/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />
        <div className="flex flex-wrap gap-2">
          <input
            name="url"
            defaultValue="/"
            className="stat h-9 w-28 rounded-lg border border-chalk/12 bg-elev px-2 text-xs text-chalk focus:border-accent/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            aria-label="Link"
          />
          <select
            name="audience"
            defaultValue="me"
            aria-label="Audience"
            className="h-9 flex-1 rounded-lg border border-chalk/12 bg-elev px-2 text-xs text-chalk focus:border-accent/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {audiences.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !configured}
            className="min-h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>

      {/* ---- triggers ---- */}
      <div className="space-y-3 border-t border-chalk/10 pt-3">
        <p className="text-xs text-dim">Automatic triggers</p>
        {settings
          .filter((s) => s.kind !== "admin")
          .map((s) => (
            <form key={s.kind} action={saveTrigger} className="rounded-lg border border-chalk/10 p-3">
              <input type="hidden" name="kind" value={s.kind} />
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-chalk">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={s.enabled}
                    className="size-4 accent-[var(--accent)]"
                  />
                  {LABELS[s.kind] ?? s.kind}
                </label>
                {s.kind !== "bad_beat" && (
                  <label className="flex items-center gap-1.5 text-xs text-dim">
                    <input
                      type="number"
                      name="lead_minutes"
                      min={0}
                      max={1440}
                      defaultValue={s.lead_minutes}
                      className="stat h-8 w-16 rounded-md border border-chalk/12 bg-elev px-1.5 text-right text-xs text-chalk focus:border-accent/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                    />
                    min ahead
                  </label>
                )}
                {s.kind === "bad_beat" && <input type="hidden" name="lead_minutes" value={0} />}
              </div>
              <input
                name="title"
                defaultValue={s.title}
                maxLength={120}
                aria-label={`${LABELS[s.kind]} title`}
                className="mb-1.5 h-8 w-full rounded-md border border-chalk/12 bg-elev px-2 text-xs text-chalk focus:border-accent/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              />
              <input
                name="body"
                defaultValue={s.body}
                maxLength={300}
                aria-label={`${LABELS[s.kind]} body`}
                className="h-8 w-full rounded-md border border-chalk/12 bg-elev px-2 text-xs text-chalk focus:border-accent/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <code className="text-[10px] text-dim">{TOKENS[s.kind]}</code>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-8 rounded-md border border-chalk/15 px-2.5 text-xs font-medium text-chalk transition-colors hover:border-chalk/30 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </form>
          ))}
      </div>

      {/* ---- log ---- */}
      <div className="mt-4 border-t border-chalk/10 pt-3">
        <p className="mb-2 text-xs text-dim">Last 20 sent</p>
        {sends.length === 0 ? (
          <p className="text-xs text-dim">Nothing sent yet.</p>
        ) : (
          <ul className="space-y-1">
            {sends.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="truncate">
                  <span
                    className={
                      row.status === "sent"
                        ? "text-win"
                        : row.status === "failed"
                          ? "text-loss"
                          : "text-dim"
                    }
                  >
                    {row.status}
                  </span>{" "}
                  <span className="text-chalk">{row.title || row.kind}</span>{" "}
                  <span className="text-dim">→ {row.who}</span>
                  {row.detail && <span className="text-dim"> · {row.detail}</span>}
                </span>
                <span className="stat shrink-0 text-dim">
                  {new Date(row.sent_at).toLocaleString("en-US", {
                    timeZone: "America/Chicago",
                    month: "numeric",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {note && <p className="mt-3 text-xs text-dim">{note}</p>}
    </section>
  );
}

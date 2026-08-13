-- The watchdog buzzes a phone (OPS-2) — part 2 of 2. Seeds the kind added in
-- 0036; see that file for why this is a separate migration and for what this
-- does and does not replace.
--
-- `enabled` and `default_enabled` both true, unlike bad beats. This kind fires
-- only when something is already broken, so the firehose argument that made bad
-- beats opt-in does not apply — the whole point is that it is hard to ignore.
--
-- Audience is admins only, and that is enforced in `watchdogJob` rather than
-- here: `notification_settings` has no audience column, because every other
-- kind derives its recipients from the event (the group with picks open, the
-- people holding the side that moved). This one derives them from
-- `profiles.is_admin`.
--
-- `lead_minutes` is meaningless for this kind. Every other kind uses it as "how
-- far ahead of the event do I fire"; there is no event to lead here, the
-- trigger is a job already being late. The column is NOT NULL with a default of
-- 90, so it is set explicitly to 0 rather than left to inherit a number that
-- would read as meaningful.
--
-- The copy is editable from /admin like every other kind. `{{jobs}}` fills with
-- the comma-separated list of jobs that have gone silent.
insert into public.notification_settings (kind, enabled, default_enabled, lead_minutes, title, body)
values (
  'watchdog', true, true, 0,
  'A job went silent',
  '{{jobs}} — no good run inside the expected cadence.'
)
on conflict (kind) do nothing;

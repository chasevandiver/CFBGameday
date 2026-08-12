-- Web Push (docs/STATUS.md PUSH-1).
--
-- iOS only delivers Web Push to a web app installed on the Home Screen, but
-- once installed it is ordinary VAPID push — the same subscription shape as
-- Chrome and Firefox. Nothing here is Apple-specific.
--
-- Four tables:
--   push_subscriptions   one row per device, owned by a user
--   notification_prefs   per-user, per-kind opt-out
--   notification_settings  per-kind switches the admin edits, not the code
--   notification_sends   append-only receipt, and the dedupe key

-- ---------------------------------------------------------------- devices --

create table public.push_subscriptions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  -- The push service's URL for this device. Unique because re-subscribing the
  -- same browser returns the same endpoint, and two rows would double-send.
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  -- Bumped whenever the client re-syncs on launch. A subscription that has not
  -- been seen in months is usually already dead at the push service.
  last_seen_at  timestamptz not null default now(),
  -- 404/410 from the push service means gone for good; anything else is
  -- transient and gets a few strikes before we stop trying.
  failure_count integer not null default 0,
  disabled_at   timestamptz
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id)
  where disabled_at is null;

alter table public.push_subscriptions enable row level security;

-- A device is private to its owner. The sender runs as the service role and
-- bypasses all of this; nothing else should ever read another user's endpoint,
-- because the endpoint plus keys IS the capability to push to their phone.
create policy "own subscriptions" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "insert own subscriptions" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
create policy "delete own subscriptions" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------ preferences --

-- The kinds a notification can be. Extending this list is a migration, which
-- is the point: a new kind means new code to detect the event, so it should
-- not be typo-able from a form.
create type public.notification_kind as enum ('picks_due', 'bad_beat', 'admin');

create table public.notification_prefs (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  kind     public.notification_kind not null,
  enabled  boolean not null default true,
  primary key (user_id, kind)
);

alter table public.notification_prefs enable row level security;
create policy "own prefs" on public.notification_prefs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- --------------------------------------------------------- admin settings --

-- One row per kind. Lives in the database rather than in code so the owner can
-- retune lead time and copy from /admin without a deploy — the difference
-- between running this and filing a ticket for it.
create table public.notification_settings (
  kind          public.notification_kind primary key,
  enabled       boolean not null default true,
  -- How far ahead of the event to fire. Only meaningful for picks_due.
  lead_minutes  integer not null default 90 check (lead_minutes between 0 and 1440),
  title         text not null,
  -- {{tokens}} are substituted by the sender; see src/lib/push.ts.
  body          text not null,
  updated_at    timestamptz not null default now()
);

insert into public.notification_settings (kind, enabled, lead_minutes, title, body) values
  ('picks_due', true, 90,
   'Picks close soon',
   '{{count}} still open in {{group}} — first kickoff at {{kickoff}}.'),
  ('bad_beat', true, 0,
   '{{team}} just flipped it',
   '{{detail}}'),
  ('admin', true, 0, '', '');

alter table public.notification_settings enable row level security;
create policy "read settings" on public.notification_settings
  for select to authenticated using (true);
-- Writes go through the admin server action on the service role, the same way
-- rating adjustments do. No client-side update policy.

-- --------------------------------------------------------------- receipts --

create table public.notification_sends (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       public.notification_kind not null,
  -- What the notification was ABOUT: 'game:4212', 'week:2026-1', 'adhoc:<ts>'.
  -- Paired with kind it is the dedupe key — the same bad beat cannot notify
  -- the same person twice, however many times the detector fires.
  subject    text not null,
  title      text not null,
  body       text not null,
  url        text,
  sent_at    timestamptz not null default now(),
  -- 'sent' once the push service accepted it. Delivery to the handset is not
  -- observable from here; this records what we handed over, not what buzzed.
  status     text not null check (status in ('sent', 'failed', 'skipped')),
  detail     text,
  unique (user_id, kind, subject)
);

create index notification_sends_recent_idx on public.notification_sends (sent_at desc);

alter table public.notification_sends enable row level security;
-- Your own receipts. The admin console reads the full log through the service
-- role, the same shape the jobs panel already uses.
create policy "own sends" on public.notification_sends
  for select to authenticated using (user_id = auth.uid());

-- Append-only, like predictions and cover_flips: a log nobody can quietly
-- rewrite, which is what makes "did it fire?" answerable after the fact.
revoke update, delete on public.notification_sends from authenticated, anon;

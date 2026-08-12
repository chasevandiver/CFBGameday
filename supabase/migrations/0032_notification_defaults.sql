-- Per-kind defaults, and a fourth kind (docs/STATUS.md, owner request Aug 12).
--
-- Split across 0032/0033 on purpose: Postgres will not let a new enum value be
-- USED in the same transaction that adds it, and 0033 seeds a row keyed on the
-- value added here. One file would fail with "unsafe use of new value".

-- Bad beats ship opt-IN. An absent notification_prefs row used to mean "on" for
-- every kind, which is right for a nudge you asked for and wrong for a firehose
-- that fires once per late swing on a twelve-game Saturday.
alter table public.notification_settings
  add column default_enabled boolean not null default true;

update public.notification_settings set default_enabled = false where kind = 'bad_beat';

-- 'log_bets': betting groups only, shortly before each Saturday kickoff wave.
alter type public.notification_kind add value if not exists 'log_bets';

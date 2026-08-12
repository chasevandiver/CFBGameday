-- Seeds the 'log_bets' kind added in 0032. Separate file because the enum value
-- cannot be referenced in the transaction that created it.
--
-- lead_minutes 20, not 15: the job only notifies about games that have not
-- kicked off, and GitHub Actions cron can lag. A few minutes of slack means a
-- prompt run still lands ~15 minutes out, and a badly delayed run sends nothing
-- rather than telling someone to log a bet on a game already playing.
insert into public.notification_settings (kind, enabled, default_enabled, lead_minutes, title, body)
values (
  'log_bets', true, true, 20,
  'Log your bets',
  '{{group}} kicks off at {{kickoff}} — get them on the sheet.'
)
on conflict (kind) do nothing;

-- Being added to a group tells you so (GRP-2) — part 2 of 2. Seeds the kind
-- added in 0065; see that file for why this is a separate migration.
--
-- `default_enabled` true. The firehose argument that made bad beats opt-in
-- (0032) is about volume: one per late swing across a twelve-game Saturday.
-- This one fires when somebody puts you in a pool, which happens a handful of
-- times ever and is always about you. Silent-by-default would make the
-- notification pointless — the people who most need telling are exactly the
-- ones who have never opened the notification settings.
--
-- `lead_minutes` 0 and meaningless, like 'watchdog': there is no event to lead,
-- the trigger has already happened. Set explicitly rather than inheriting the
-- column's default of 90, which would read as a number somebody chose.
--
-- Tokens: {{group}} and {{admin}} — the group's name and the display name of
-- the admin who did it. Naming the admin is the point. "You were added to
-- Saturday Boys" from nobody in particular reads like something the site did;
-- "Chase added you" is a person, and a person is who you ask about it.
insert into public.notification_settings (kind, enabled, default_enabled, lead_minutes, title, body)
values (
  'added_to_group', true, true, 0,
  'You’re in {{group}}',
  '{{admin}} added you. Tap to open it.'
)
on conflict (kind) do nothing;

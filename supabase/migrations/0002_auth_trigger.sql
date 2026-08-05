-- Invite-only enforcement: signups succeed only for allowlisted emails.
-- The trigger runs on auth.users insert, so rejection happens at the auth
-- layer itself — no app-side checks to bypass.

alter table public.invite_allowlist
  add column if not exists make_admin boolean not null default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.invite_allowlist%rowtype;
begin
  select * into invite
  from public.invite_allowlist
  where lower(email) = lower(new.email);

  if not found then
    raise exception 'This site is invite-only. Ask the commissioner to add %', new.email;
  end if;

  insert into public.profiles (id, display_name, is_admin)
  values (new.id, split_part(new.email, '@', 1), invite.make_admin)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Seed the commissioner
insert into public.invite_allowlist (email, make_admin)
values ('chasevandiver@gmail.com', true)
on conflict (email) do update set make_admin = true;

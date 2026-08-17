-- R2-D4 — reactions: one tap on a pick or a bet. Not a chat room.
--
-- The social layer stays export-only for conversation (share cards into the
-- real group chat — a deliberate decision, see the changelog); this is the
-- one-tap layer that lets the receipts feel it. Four emoji, allow-listed:
-- fire, skull, ice, dart. No free text anywhere.
--
-- ## Visibility is INVOKER semantics, on purpose
--
-- `reaction_subject_visible` is SECURITY INVOKER: it asks "can the CALLER
-- see this pick/bet row" under the caller's own RLS. That makes the rule
-- exactly "you may see/react to a reaction's subject iff you may see the
-- subject" — hidden picks (0023) stay unreactable before kickoff, and a
-- reaction can never become an existence oracle for a row the blind hides:
-- an invisible pick id and a nonexistent one refuse identically.
--
-- Apply-vs-deploy order is free: new table, nothing in the running code
-- reads it.

create table public.reactions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  subject     text not null check (subject in ('pick', 'bet')),
  subject_id  bigint not null,
  emoji       text not null check (emoji in ('fire', 'skull', 'ice', 'dart')),
  created_at  timestamptz not null default now(),
  unique (user_id, subject, subject_id, emoji)
);

create index reactions_subject_idx on public.reactions (subject, subject_id);

alter table public.reactions enable row level security;

create or replace function public.reaction_subject_visible(p_subject text, p_id bigint)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case p_subject
    when 'pick' then exists (select 1 from picks where id = p_id)
    when 'bet'  then exists (select 1 from bets where id = p_id and voided_at is null)
    else false
  end;
$$;
grant execute on function public.reaction_subject_visible(text, bigint) to authenticated;

create policy "read reactions on visible subjects" on public.reactions
  for select to authenticated
  using (public.reaction_subject_visible(subject, subject_id));

create policy "react to visible subjects" on public.reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.reaction_subject_visible(subject, subject_id)
  );

create policy "unreact own" on public.reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke update, truncate on public.reactions from public, anon, authenticated;

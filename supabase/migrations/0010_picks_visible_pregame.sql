-- Picks are visible to the whole crew at all times (owner decision, Aug 2026).
-- The pre-kickoff blind from 0001 ("read others picks after kickoff") is gone:
-- sweating each other's cards before kickoff is part of the product now.
--
-- Writes are untouched — picks still lock at kickoff via the insert/update/
-- delete policies in 0001 (League Rules #1–#2 stand; only visibility changed).

drop policy if exists "read own picks" on picks;
drop policy if exists "read others picks after kickoff" on picks;

create policy "read all picks" on picks for select to authenticated using (true);

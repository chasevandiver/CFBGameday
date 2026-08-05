-- Admin UI for rating adjustments (docs/SPEC.md §2.2): admins could already
-- read and confirm proposals, but had no way to create or retract them from
-- the app. Manual adjustments insert as source='manual'; retracting one never
-- rewrites history — frozen predictions that already priced it stay frozen.

create policy "admins insert adjustments" on rating_adjustments for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

create policy "admins delete adjustments" on rating_adjustments for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

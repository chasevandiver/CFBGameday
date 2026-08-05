-- handle_new_user only ever runs as the auth trigger; nobody calls it via API
revoke execute on function public.handle_new_user() from anon, authenticated, public;

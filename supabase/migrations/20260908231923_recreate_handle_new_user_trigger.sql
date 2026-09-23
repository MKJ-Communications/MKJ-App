-- The handle_new_user() function (defined in an earlier migration) copies
-- full_name into public.profiles on signup, but the trigger wiring it to
-- auth.users inserts was missing from the live project (list_migrations
-- shows nothing tracked here — schema was pushed via Lovable's own sync,
-- not the Supabase CLI, so this trigger apparently never made it across).
-- Effect: every signup got no profiles row at all, so the app fell back to
-- displaying the user's email instead of their full name.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill the one user created while the trigger was missing.
insert into public.profiles (id, email, full_name)
values ('f1c3ebb5-3917-4dee-ad0a-c6b6ec0a0d22', 'cesar@mkjcomm.com', 'Cesar Hernandez')
on conflict (id) do nothing;

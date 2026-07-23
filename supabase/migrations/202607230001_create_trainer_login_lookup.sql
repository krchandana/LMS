-- Trainer sign-in begins before a user has an authenticated session.  Keep the
-- email lookup behind a narrowly-scoped security-definer function so it works
-- with profiles RLS enabled, without granting anonymous users table access.
create or replace function public.find_trainer_login_email(p_full_name text)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p.email
  from public.profiles as p
  where lower(regexp_replace(trim(coalesce(p.full_name, '')), '\s+', ' ', 'g')) =
        lower(regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g'))
    and lower(coalesce(p.role, '')) = 'trainer'
  limit 1;
$$;

revoke all on function public.find_trainer_login_email(text) from public;
grant execute on function public.find_trainer_login_email(text) to anon, authenticated;

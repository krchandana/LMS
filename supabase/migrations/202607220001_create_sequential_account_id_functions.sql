-- Generate human-readable account IDs in database sequences so simultaneous
-- registrations cannot receive the same ID. Sequence values may have gaps when
-- an account creation is cancelled or fails, but IDs are always increasing.
create sequence if not exists public.student_login_id_seq as bigint start with 1 minvalue 1;
create sequence if not exists public.trainer_reference_id_seq as bigint start with 1 minvalue 1;

do $$
declare
  highest_student_id bigint := 0;
  candidate_student_id bigint;
  student_id_column text;
  source_table text;
begin
  -- Earlier deployments used either student_id or student_login_id. Check
  -- both names so this migration can run safely against either schema.
  foreach source_table in array array['profiles', 'access_requests'] loop
    for student_id_column in
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = source_table
        and column_name in ('student_id', 'student_login_id')
    loop
      execute format(
        'select coalesce(max(substring(%1$I from ''^STU([0-9]+)$'')::bigint), 0) from public.%2$I where %1$I ~ ''^STU[0-9]+$''',
        student_id_column,
        source_table
      ) into candidate_student_id;
      highest_student_id := greatest(highest_student_id, candidate_student_id);
    end loop;
  end loop;

  if highest_student_id > 0 then
    perform setval('public.student_login_id_seq', highest_student_id, true);
  else
    perform setval('public.student_login_id_seq', 1, false);
  end if;
end;
$$;

create or replace function public.next_student_login_id()
returns text
language sql
security definer
set search_path = public
as $$
  select 'STU' || lpad(nextval('public.student_login_id_seq')::text, 5, '0');
$$;

create or replace function public.next_trainer_reference_id()
returns text
language sql
security definer
set search_path = public
as $$
  select 'TRN-' || lpad(nextval('public.trainer_reference_id_seq')::text, 5, '0');
$$;

grant execute on function public.next_student_login_id() to anon, authenticated;
grant execute on function public.next_trainer_reference_id() to authenticated;

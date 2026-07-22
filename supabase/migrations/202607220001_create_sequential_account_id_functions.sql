-- Generate human-readable account IDs in database sequences so simultaneous
-- registrations cannot receive the same ID. Sequence values may have gaps when
-- an account creation is cancelled or fails, but IDs are always increasing.
create sequence if not exists public.student_login_id_seq as bigint start with 1 minvalue 1;
create sequence if not exists public.trainer_reference_id_seq as bigint start with 1 minvalue 1;

do $$
declare
  highest_student_id bigint;
begin
  select greatest(
    coalesce((
      select max(substring(student_id from '^STU([0-9]+)$')::bigint)
      from public.profiles
      where student_id ~ '^STU[0-9]+$'
    ), 0),
    coalesce((
      select max(substring(student_id from '^STU([0-9]+)$')::bigint)
      from public.access_requests
      where student_id ~ '^STU[0-9]+$'
    ), 0)
  ) into highest_student_id;

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

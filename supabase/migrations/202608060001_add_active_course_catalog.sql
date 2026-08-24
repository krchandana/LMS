-- Let signed-in learners browse the active courses created by administrators
-- without granting direct read access to every course row or changing existing
-- course policies used by administrators and trainers.
create or replace function public.list_active_course_catalog()
returns setof public.courses
language sql
security definer
set search_path = public
as $$
  select *
  from public.courses
  where coalesce(lower(status), 'active') = 'active'
  order by id desc;
$$;

revoke all on function public.list_active_course_catalog() from public;
grant execute on function public.list_active_course_catalog() to authenticated;

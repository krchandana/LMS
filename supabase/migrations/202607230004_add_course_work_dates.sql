-- Store a visible assignment date and a hard end date for every item of
-- course work. Existing assignment due dates become their end dates.
alter table public.assignments
  add column if not exists assigned_date date,
  add column if not exists end_date date;

alter table public.projects
  add column if not exists assigned_date date,
  add column if not exists end_date date;

update public.assignments
set assigned_date = coalesce(assigned_date, created_at::date),
    end_date = coalesce(end_date, due_date)
where assigned_date is null or end_date is null;

update public.projects
set assigned_date = coalesce(assigned_date, created_at::date)
where assigned_date is null;

create index if not exists assignments_end_date_idx on public.assignments (end_date) where end_date is not null;
create index if not exists projects_end_date_idx on public.projects (end_date) where end_date is not null;

drop function if exists public.assign_assignment_to_enrolled_students(uuid, text, text, date);
create function public.assign_assignment_to_enrolled_students(
  p_course_id uuid,
  p_title text,
  p_description text,
  p_assigned_date date,
  p_end_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  enrolled_count integer;
begin
  if p_assigned_date is null or p_end_date is null or p_end_date < p_assigned_date then
    raise exception 'Provide an assignment date and an end date on or after it.';
  end if;

  if not exists (select 1 from public.courses where id = p_course_id and trainer_id = auth.uid()) then
    raise exception 'You can only assign work for your own course.';
  end if;

  select count(*) into enrolled_count from public.enrollments where course_id = p_course_id and student_id is not null;
  if enrolled_count = 0 then return 0; end if;

  insert into public.assignments (course_id, trainer_id, title, description, assigned_date, end_date, due_date, status)
  values (p_course_id, auth.uid(), p_title, p_description, p_assigned_date, p_end_date, p_end_date, 'active');
  return enrolled_count;
end;
$$;

drop function if exists public.assign_project_to_enrolled_students(uuid, text, text);
create function public.assign_project_to_enrolled_students(
  p_course_id uuid,
  p_title text,
  p_description text,
  p_assigned_date date,
  p_end_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  delivered_count integer;
begin
  if p_assigned_date is null or p_end_date is null or p_end_date < p_assigned_date then
    raise exception 'Provide a project assignment date and an end date on or after it.';
  end if;

  if not exists (select 1 from public.courses where id = p_course_id and trainer_id = auth.uid()) then
    raise exception 'You can only assign work for your own course.';
  end if;

  insert into public.projects (course_id, student_id, title, description, assigned_date, end_date, status)
  select p_course_id, enrollment.student_id, p_title, p_description, p_assigned_date, p_end_date, 'pending'
  from public.enrollments as enrollment
  where enrollment.course_id = p_course_id and enrollment.student_id is not null;
  get diagnostics delivered_count = row_count;
  return delivered_count;
end;
$$;

grant execute on function public.assign_assignment_to_enrolled_students(uuid, text, text, date, date) to authenticated;
grant execute on function public.assign_project_to_enrolled_students(uuid, text, text, date, date) to authenticated;

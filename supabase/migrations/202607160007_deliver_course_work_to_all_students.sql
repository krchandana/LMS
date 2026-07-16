-- Create course work on the server so trainer RLS does not limit a bulk
-- delivery to only the currently authenticated account.
create or replace function public.assign_assignment_to_enrolled_students(
  p_course_id uuid,
  p_title text,
  p_description text,
  p_due_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  delivered_count integer;
begin
  if not exists (
    select 1 from public.courses
    where id = p_course_id and trainer_id = auth.uid()
  ) then
    raise exception 'You can only assign work for your own course.';
  end if;

  insert into public.assignments (course_id, student_id, trainer_id, title, description, due_date, status)
  select p_course_id, enrollment.student_id, auth.uid(), p_title, p_description, p_due_date, 'active'
  from public.enrollments as enrollment
  where enrollment.course_id = p_course_id
    and enrollment.student_id is not null;

  get diagnostics delivered_count = row_count;
  return delivered_count;
end;
$$;

create or replace function public.assign_project_to_enrolled_students(
  p_course_id uuid,
  p_title text,
  p_description text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  delivered_count integer;
begin
  if not exists (
    select 1 from public.courses
    where id = p_course_id and trainer_id = auth.uid()
  ) then
    raise exception 'You can only assign work for your own course.';
  end if;

  insert into public.projects (course_id, student_id, title, description, status)
  select p_course_id, enrollment.student_id, p_title, p_description, 'pending'
  from public.enrollments as enrollment
  where enrollment.course_id = p_course_id
    and enrollment.student_id is not null;

  get diagnostics delivered_count = row_count;
  return delivered_count;
end;
$$;

grant execute on function public.assign_assignment_to_enrolled_students(uuid, text, text, date) to authenticated;
grant execute on function public.assign_project_to_enrolled_students(uuid, text, text) to authenticated;

-- Assignments are course-level records in this schema. One assignment is
-- therefore created for a course and made visible to every enrollment.
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
  enrolled_count integer;
begin
  if not exists (
    select 1 from public.courses
    where id = p_course_id and trainer_id = auth.uid()
  ) then
    raise exception 'You can only assign work for your own course.';
  end if;

  select count(*) into enrolled_count
  from public.enrollments
  where course_id = p_course_id and student_id is not null;

  if enrolled_count = 0 then
    return 0;
  end if;

  insert into public.assignments (course_id, trainer_id, title, description, due_date, status)
  values (p_course_id, auth.uid(), p_title, p_description, p_due_date, 'active');

  return enrolled_count;
end;
$$;

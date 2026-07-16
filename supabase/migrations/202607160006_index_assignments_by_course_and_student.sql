-- Assignment deliveries are stored per student and course so a learner only
-- receives work for courses in which they are enrolled.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assignments' and column_name = 'student_id'
  ) then
    execute 'create index if not exists assignments_course_student_idx on public.assignments (course_id, student_id)';
  end if;
end $$;

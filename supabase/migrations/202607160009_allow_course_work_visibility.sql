-- Let a signed-in learner read and resubmit only their own projects, and
-- read assignments for courses in which they have an active enrollment.
alter table public.projects enable row level security;
alter table public.assignments enable row level security;

drop policy if exists "Students can view their own projects" on public.projects;
create policy "Students can view their own projects"
on public.projects for select to authenticated
using (student_id = (select auth.uid()));

drop policy if exists "Students can resubmit their own projects" on public.projects;
create policy "Students can resubmit their own projects"
on public.projects for update to authenticated
using (student_id = (select auth.uid()))
with check (student_id = (select auth.uid()));

drop policy if exists "Trainers can view projects for their courses" on public.projects;
create policy "Trainers can view projects for their courses"
on public.projects for select to authenticated
using (
  exists (
    select 1 from public.courses
    where courses.id = projects.course_id and courses.trainer_id = (select auth.uid())
  )
);

drop policy if exists "Trainers can review projects for their courses" on public.projects;
create policy "Trainers can review projects for their courses"
on public.projects for update to authenticated
using (
  exists (
    select 1 from public.courses
    where courses.id = projects.course_id and courses.trainer_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.courses
    where courses.id = projects.course_id and courses.trainer_id = (select auth.uid())
  )
);

drop policy if exists "Students can view assignments for enrolled courses" on public.assignments;
create policy "Students can view assignments for enrolled courses"
on public.assignments for select to authenticated
using (
  exists (
    select 1 from public.enrollments
    where enrollments.course_id = assignments.course_id
      and enrollments.student_id = (select auth.uid())
  )
);

drop policy if exists "Trainers can view assignments for their courses" on public.assignments;
create policy "Trainers can view assignments for their courses"
on public.assignments for select to authenticated
using (
  exists (
    select 1 from public.courses
    where courses.id = assignments.course_id and courses.trainer_id = (select auth.uid())
  )
);

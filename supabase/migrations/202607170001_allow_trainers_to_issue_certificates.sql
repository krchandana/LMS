-- Trainers may issue certificates only for students enrolled in courses they own.
-- This resolves the RLS rejection raised when the trainer dashboard inserts a
-- certificate after all work has been approved.
alter table public.certificates enable row level security;

drop policy if exists "Trainers can issue certificates for their courses" on public.certificates;
create policy "Trainers can issue certificates for their courses"
on public.certificates
for insert
to authenticated
with check (
  issued_by = (select auth.uid())
  and exists (
    select 1
    from public.courses
    where courses.id = certificates.course_id
      and courses.trainer_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.enrollments
    where enrollments.course_id = certificates.course_id
      and enrollments.student_id = certificates.student_id
  )
);

drop policy if exists "Trainers can view certificates for their courses" on public.certificates;
create policy "Trainers can view certificates for their courses"
on public.certificates
for select
to authenticated
using (
  exists (
    select 1
    from public.courses
    where courses.id = certificates.course_id
      and courses.trainer_id = (select auth.uid())
  )
);

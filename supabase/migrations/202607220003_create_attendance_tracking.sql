-- Attendance records power the low-attendance monitoring insight.
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  attendance_date date not null default current_date,
  status text not null check (status in ('present', 'absent', 'late')),
  created_at timestamptz not null default now(),
  unique (student_id, course_id, attendance_date)
);

create index if not exists attendance_student_course_idx
  on public.attendance (student_id, course_id, attendance_date desc);

alter table public.attendance enable row level security;

drop policy if exists "Students can view their own attendance" on public.attendance;
create policy "Students can view their own attendance"
on public.attendance for select to authenticated
using (student_id = (select auth.uid()));

drop policy if exists "Admins can view attendance" on public.attendance;
create policy "Admins can view attendance"
on public.attendance for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'admin'
  )
);

drop policy if exists "Trainers can manage attendance for their courses" on public.attendance;
create policy "Trainers can manage attendance for their courses"
on public.attendance for all to authenticated
using (
  exists (
    select 1 from public.courses
    where courses.id = attendance.course_id and courses.trainer_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.courses
    where courses.id = attendance.course_id and courses.trainer_id = (select auth.uid())
  )
);

create table if not exists public.course_reviews (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  trainer_feedback text,
  trainer_feedback_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, student_id)
);

alter table public.course_reviews enable row level security;

create policy "Students review completed courses" on public.course_reviews for insert to authenticated
with check (
  student_id = (select auth.uid())
  and exists (select 1 from public.certificates where certificates.student_id = (select auth.uid()) and certificates.course_id = course_reviews.course_id)
);

create policy "Students view their course reviews" on public.course_reviews for select to authenticated
using (student_id = (select auth.uid()));

create policy "Trainers view and reply to course reviews" on public.course_reviews for select to authenticated
using (exists (select 1 from public.courses where courses.id = course_reviews.course_id and courses.trainer_id = (select auth.uid())));

create policy "Trainers reply to course reviews" on public.course_reviews for update to authenticated
using (exists (select 1 from public.courses where courses.id = course_reviews.course_id and courses.trainer_id = (select auth.uid())))
with check (exists (select 1 from public.courses where courses.id = course_reviews.course_id and courses.trainer_id = (select auth.uid())));

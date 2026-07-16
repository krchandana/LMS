create table if not exists public.course_videos (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  video_url text not null,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists course_videos_course_id_idx on public.course_videos (course_id, available_at desc);

alter table public.course_videos enable row level security;

create policy "Authenticated users can view course videos"
on public.course_videos for select
to authenticated
using (true);

create policy "Trainers can post their course videos"
on public.course_videos for insert
to authenticated
with check (trainer_id = (select auth.uid()));

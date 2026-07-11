create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  user_id uuid,
  student_id text,
  student_login_id text,
  full_name text,
  name text,
  email text not null,
  auth_email text,
  role text not null default 'student',
  status text not null default 'pending',
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists access_requests_status_idx on public.access_requests (status);
create index if not exists access_requests_created_at_idx on public.access_requests (created_at desc);
create index if not exists access_requests_email_idx on public.access_requests (email);

alter table public.access_requests enable row level security;

drop policy if exists "Authenticated users can read access requests" on public.access_requests;
create policy "Authenticated users can read access requests"
on public.access_requests
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can create access requests" on public.access_requests;
create policy "Authenticated users can create access requests"
on public.access_requests
for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update access requests" on public.access_requests;
create policy "Authenticated users can update access requests"
on public.access_requests
for update
to authenticated
using (true)
with check (true);

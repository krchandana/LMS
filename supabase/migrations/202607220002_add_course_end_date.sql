-- A course remains active after its end date until an administrator approves
-- the status change in the admin dashboard.
alter table if exists public.courses
  add column if not exists end_date date;

create index if not exists courses_end_date_idx
  on public.courses (end_date)
  where end_date is not null;

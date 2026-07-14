-- The trainer workflow uses approved, rejected, and rework after a student
-- submits work. Keep the database constraint aligned with those UI states.
alter table if exists public.submissions
  drop constraint if exists submissions_status_check;

alter table if exists public.submissions
  add constraint submissions_status_check
  check (
    status is null
    or lower(status) in ('pending', 'submitted', 'approved', 'rejected', 'rework', 'reviewed')
  );

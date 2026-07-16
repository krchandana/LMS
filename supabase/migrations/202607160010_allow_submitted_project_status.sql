-- A student submission moves an assigned project from pending to submitted.
-- Keep the project workflow statuses aligned with the student and trainer UI.
alter table public.projects
  drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status in ('pending', 'submitted', 'approved', 'rejected', 'rework'));

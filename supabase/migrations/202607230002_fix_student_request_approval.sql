-- Some early installations already had access_requests before the registration
-- migration added the audit timestamp. Approval must not fail on those tables.
alter table public.access_requests
  add column if not exists updated_at timestamptz not null default now();

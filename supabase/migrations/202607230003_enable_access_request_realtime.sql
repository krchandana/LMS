-- Notify open admin dashboards as soon as a learner submits or resolves an
-- access request. The exception keeps this migration safe to apply repeatedly.
alter table public.access_requests replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.access_requests;
exception
  when duplicate_object then null;
end;
$$;

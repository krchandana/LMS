-- A certificate belongs to its student. This allows it to appear in the
-- student's dashboard as soon as it is issued by their trainer.
alter table public.certificates enable row level security;

drop policy if exists "Students can view their own certificates" on public.certificates;
create policy "Students can view their own certificates"
on public.certificates
for select
to authenticated
using (student_id = (select auth.uid()));

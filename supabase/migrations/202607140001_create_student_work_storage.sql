insert into storage.buckets (id, name, public, file_size_limit)
values ('student-work', 'student-work', true, 52428800)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit;

create policy "Students can upload their own work files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'student-work'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

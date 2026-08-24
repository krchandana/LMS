do $$
begin
  alter publication supabase_realtime add table public.course_reviews;
exception
  when duplicate_object then null;
end $$;

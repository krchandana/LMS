-- Keep the trainer display name with the course so enrolled students can
-- render their assigned trainer without needing read access to all profiles.
alter table if exists public.courses
  add column if not exists trainer_name text;

update public.courses as course
set trainer_name = profile.full_name
from public.profiles as profile
where course.trainer_id = profile.id
  and profile.role = 'trainer'
  and coalesce(course.trainer_name, '') <> coalesce(profile.full_name, '');

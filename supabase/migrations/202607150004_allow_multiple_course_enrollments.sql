-- A learner may take more than one course.  An enrollment therefore belongs
-- to the (student_id, course_id) pair, not to student_id alone.
--
-- This is intentionally defensive because the original enrollments table was
-- created outside the migrations in some environments.
do $$
declare
  student_column smallint;
  course_column smallint;
  candidate record;
begin
  if to_regclass('public.enrollments') is null then
    raise notice 'Skipping enrollment constraint update because public.enrollments does not exist.';
    return;
  end if;

  select attnum::smallint into student_column
  from pg_attribute
  where attrelid = 'public.enrollments'::regclass
    and attname = 'student_id'
    and not attisdropped;

  select attnum::smallint into course_column
  from pg_attribute
  where attrelid = 'public.enrollments'::regclass
    and attname = 'course_id'
    and not attisdropped;

  if student_column is null or course_column is null then
    raise exception 'public.enrollments must contain student_id and course_id columns';
  end if;

  -- Remove an old UNIQUE(student_id) constraint, which prevents a second
  -- course from being assigned to the same learner.
  for candidate in
    select conname
    from pg_constraint
    where conrelid = 'public.enrollments'::regclass
      and contype = 'u'
      and conkey::smallint[] = array[student_column]::smallint[]
  loop
    execute format('alter table public.enrollments drop constraint %I', candidate.conname);
  end loop;

  -- Do the same for an independently-created one-column unique index.
  for candidate in
    select index_class.relname as index_name
    from pg_index index_definition
    join pg_class index_class on index_class.oid = index_definition.indexrelid
    left join pg_constraint constraint_definition on constraint_definition.conindid = index_definition.indexrelid
    where index_definition.indrelid = 'public.enrollments'::regclass
      and index_definition.indisunique
      and index_definition.indnatts = 1
      and index_definition.indkey::smallint[] = array[student_column]::smallint[]
      and constraint_definition.oid is null
  loop
    execute format('drop index if exists public.%I', candidate.index_name);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.enrollments'::regclass
      and contype = 'u'
      and (
        conkey::smallint[] = array[student_column, course_column]::smallint[]
        or conkey::smallint[] = array[course_column, student_column]::smallint[]
      )
  ) then
    alter table public.enrollments
      add constraint enrollments_student_course_key unique (student_id, course_id);
  end if;
end $$;

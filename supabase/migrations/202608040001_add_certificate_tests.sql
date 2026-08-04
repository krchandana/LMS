-- A trainer defines one final multiple-choice test for each course. Students
-- must score strictly above 75% within three attempts before certification.
create table if not exists public.course_certificate_tests (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null unique references public.courses(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Course certificate test',
  questions jsonb not null,
  passing_score numeric(5,2) not null default 75 check (passing_score > 0 and passing_score <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) >= 5)
);

create table if not exists public.certificate_test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.course_certificate_tests(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  score numeric(5,2) not null check (score >= 0 and score <= 100),
  passed boolean not null default false,
  attempt_number integer not null check (attempt_number between 1 and 3),
  attempted_at timestamptz not null default now(),
  next_attempt_at timestamptz,
  unique (test_id, student_id, attempt_number)
);

create index if not exists certificate_test_attempts_student_course_idx
  on public.certificate_test_attempts (student_id, course_id, attempted_at desc);

alter table public.course_certificate_tests enable row level security;
alter table public.certificate_test_attempts enable row level security;

drop policy if exists "Trainers manage certificate tests for their courses" on public.course_certificate_tests;
create policy "Trainers manage certificate tests for their courses"
on public.course_certificate_tests for all to authenticated
using (
  trainer_id = (select auth.uid())
  and exists (select 1 from public.courses where courses.id = course_certificate_tests.course_id and courses.trainer_id = (select auth.uid()))
)
with check (
  trainer_id = (select auth.uid())
  and exists (select 1 from public.courses where courses.id = course_certificate_tests.course_id and courses.trainer_id = (select auth.uid()))
);

drop policy if exists "Trainers view certificate test attempts for their courses" on public.certificate_test_attempts;
create policy "Trainers view certificate test attempts for their courses"
on public.certificate_test_attempts for select to authenticated
using (exists (select 1 from public.courses where courses.id = certificate_test_attempts.course_id and courses.trainer_id = (select auth.uid())));

drop policy if exists "Students view their certificate test attempts" on public.certificate_test_attempts;
create policy "Students view their certificate test attempts"
on public.certificate_test_attempts for select to authenticated
using (student_id = (select auth.uid()));

create or replace function public.get_my_certificate_tests()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'course_id'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', test.id,
      'course_id', test.course_id,
      'title', test.title,
      'passing_score', test.passing_score,
      'questions', (
        select jsonb_agg(question.value - 'correct_option')
        from jsonb_array_elements(test.questions) as question(value)
      ),
      'attempt_count', coalesce(attempt_stats.attempt_count, 0),
      'passed', coalesce(attempt_stats.passed, false),
      'latest_score', attempt_stats.latest_score,
      'next_attempt_at', attempt_stats.next_attempt_at
    ) as row_data
    from public.course_certificate_tests test
    join public.enrollments enrollment on enrollment.course_id = test.course_id and enrollment.student_id = (select auth.uid())
    left join lateral (
      select count(*)::integer as attempt_count,
             bool_or(attempt.passed) as passed,
             (array_agg(attempt.score order by attempt.attempted_at desc))[1] as latest_score,
             (array_agg(attempt.next_attempt_at order by attempt.attempted_at desc))[1] as next_attempt_at
      from public.certificate_test_attempts attempt
      where attempt.test_id = test.id and attempt.student_id = (select auth.uid())
    ) attempt_stats on true
  ) tests;
$$;

create or replace function public.submit_certificate_test(p_test_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  test_record public.course_certificate_tests%rowtype;
  prior_attempts integer;
  retry_at timestamptz;
  question jsonb;
  total_questions integer := 0;
  correct_answers integer := 0;
  result_score numeric(5,2);
  did_pass boolean;
begin
  select test.* into test_record
  from public.course_certificate_tests test
  join public.enrollments enrollment on enrollment.course_id = test.course_id
  where test.id = p_test_id and enrollment.student_id = (select auth.uid());

  if not found then raise exception 'Certificate test is not available for this student.'; end if;

  select count(*)::integer, max(next_attempt_at) into prior_attempts, retry_at
  from public.certificate_test_attempts
  where test_id = p_test_id and student_id = (select auth.uid());

  if prior_attempts >= 3 then raise exception 'All three certificate-test attempts have been used.'; end if;
  if retry_at is not null and retry_at > now() then raise exception 'Your next test attempt is available after %.', retry_at; end if;

  for question in select value from jsonb_array_elements(test_record.questions) loop
    total_questions := total_questions + 1;
    if coalesce(p_answers ->> (question ->> 'id'), '') = coalesce(question ->> 'correct_option', '') then
      correct_answers := correct_answers + 1;
    end if;
  end loop;

  if total_questions = 0 then raise exception 'This certificate test has no questions.'; end if;
  result_score := round((correct_answers::numeric / total_questions::numeric) * 100, 2);
  did_pass := result_score > test_record.passing_score;

  insert into public.certificate_test_attempts (test_id, course_id, student_id, answers, score, passed, attempt_number, next_attempt_at)
  values (
    test_record.id,
    test_record.course_id,
    (select auth.uid()),
    coalesce(p_answers, '{}'::jsonb),
    result_score,
    did_pass,
    prior_attempts + 1,
    case when did_pass then null else now() + interval '1 day' end
  );

  return jsonb_build_object(
    'score', result_score,
    'passed', did_pass,
    'attempt_number', prior_attempts + 1,
    'attempts_remaining', 3 - (prior_attempts + 1),
    'next_attempt_at', case when did_pass then null else now() + interval '1 day' end
  );
end;
$$;

grant execute on function public.get_my_certificate_tests() to authenticated;
grant execute on function public.submit_certificate_test(uuid, jsonb) to authenticated;

-- Certificate inserts are enforced at the database layer too, so a client
-- cannot bypass the required final test.
drop policy if exists "Trainers can issue certificates for their courses" on public.certificates;
create policy "Trainers can issue certificates for their courses"
on public.certificates for insert to authenticated
with check (
  issued_by = (select auth.uid())
  and exists (select 1 from public.courses where courses.id = certificates.course_id and courses.trainer_id = (select auth.uid()))
  and exists (select 1 from public.enrollments where enrollments.course_id = certificates.course_id and enrollments.student_id = certificates.student_id)
  and exists (
    select 1
    from public.certificate_test_attempts attempt
    join public.course_certificate_tests test on test.id = attempt.test_id
    where attempt.student_id = certificates.student_id
      and attempt.course_id = certificates.course_id
      and attempt.passed = true
      and attempt.score > test.passing_score
  )
);

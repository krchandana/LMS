-- Automatically generated tests contain three distinct five-question sets:
-- one for each permitted student attempt.

-- The generated format is an array of three question arrays. The initial
-- schema only permitted a flat array of five questions, which rejected every
-- generated test before a student could complete it and receive a certificate.
alter table public.course_certificate_tests
  drop constraint if exists course_certificate_tests_questions_check;

alter table public.course_certificate_tests
  add constraint course_certificate_tests_questions_check
  check (
    jsonb_typeof(questions) = 'array'
    and jsonb_array_length(questions) >= 3
  );

-- Give a student the next unused question set, without exposing correct
-- answers. Existing trainer-authored flat tests remain supported.
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
        from jsonb_array_elements(
          case when jsonb_typeof(test.questions -> 0) = 'array'
            then test.questions -> least(coalesce(attempt_stats.attempt_count, 0), 2)
            else test.questions
          end
        ) as question(value)
      ),
      'attempt_count', coalesce(attempt_stats.attempt_count, 0),
      'passed', coalesce(attempt_stats.passed, false),
      'latest_score', attempt_stats.latest_score,
      'next_attempt_at', attempt_stats.next_attempt_at
    ) as row_data
    from public.course_certificate_tests test
    join public.enrollments enrollment
      on enrollment.course_id = test.course_id
      and enrollment.student_id = (select auth.uid())
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

-- Grade against the same set presented to the student. Each failed attempt
-- progresses to the next generated set; flat legacy tests use their one set.
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
  question_set jsonb;
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

  question_set := case when jsonb_typeof(test_record.questions -> 0) = 'array'
    then test_record.questions -> prior_attempts
    else test_record.questions
  end;

  for question in select value from jsonb_array_elements(question_set) loop
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

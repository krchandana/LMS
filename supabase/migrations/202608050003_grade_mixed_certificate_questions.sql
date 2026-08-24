-- Grade generated multiple-choice, true/false, short-answer, and coding questions.
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
  submitted_answer text;
  total_questions integer := 0;
  correct_answers integer := 0;
  result_score numeric(5,2);
  did_pass boolean;
  issued_certificate_id uuid;
begin
  select test.* into test_record from public.course_certificate_tests test
  join public.enrollments enrollment on enrollment.course_id = test.course_id
  where test.id = p_test_id and enrollment.student_id = (select auth.uid());
  if not found then raise exception 'Certificate test is not available for this student.'; end if;

  select count(*)::integer, max(next_attempt_at) into prior_attempts, retry_at
  from public.certificate_test_attempts where test_id = p_test_id and student_id = (select auth.uid());
  if prior_attempts >= 3 then raise exception 'All three certificate-test attempts have been used.'; end if;
  if retry_at is not null and retry_at > now() then raise exception 'Your next test attempt is available after %.', retry_at; end if;

  question_set := case when jsonb_typeof(test_record.questions -> 0) = 'array' then test_record.questions -> prior_attempts else test_record.questions end;
  for question in select value from jsonb_array_elements(question_set) loop
    total_questions := total_questions + 1;
    submitted_answer := lower(trim(coalesce(p_answers ->> (question ->> 'id'), '')));
    if coalesce(question ->> 'type', 'multiple_choice') in ('multiple_choice', 'true_false') then
      if submitted_answer = lower(coalesce(question ->> 'correct_option', '')) then correct_answers := correct_answers + 1; end if;
    elsif exists (
      select 1 from jsonb_array_elements_text(coalesce(question -> 'correct_keywords', '[]'::jsonb)) keyword(value)
      where submitted_answer like '%' || lower(keyword.value) || '%'
    ) then
      correct_answers := correct_answers + 1;
    end if;
  end loop;

  if total_questions = 0 then raise exception 'This certificate test has no questions.'; end if;
  result_score := round((correct_answers::numeric / total_questions::numeric) * 100, 2);
  did_pass := result_score > test_record.passing_score;
  insert into public.certificate_test_attempts (test_id, course_id, student_id, answers, score, passed, attempt_number, next_attempt_at)
  values (test_record.id, test_record.course_id, (select auth.uid()), coalesce(p_answers, '{}'::jsonb), result_score, did_pass, prior_attempts + 1, case when did_pass then null else now() + interval '1 day' end);

  if did_pass then
    insert into public.certificates (student_id, course_id, issued_by, certificate_number, issue_date, status)
    values ((select auth.uid()), test_record.course_id, test_record.trainer_id, 'CERT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), current_date, 'issued')
    on conflict do nothing returning id into issued_certificate_id;
    if issued_certificate_id is null then select id into issued_certificate_id from public.certificates where student_id = (select auth.uid()) and course_id = test_record.course_id limit 1; end if;
  end if;

  return jsonb_build_object('score', result_score, 'passed', did_pass, 'attempt_number', prior_attempts + 1, 'attempts_remaining', 3 - (prior_attempts + 1), 'next_attempt_at', case when did_pass then null else now() + interval '1 day' end, 'certificate_id', issued_certificate_id);
end;
$$;

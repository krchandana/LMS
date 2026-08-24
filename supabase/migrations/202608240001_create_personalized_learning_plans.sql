create table if not exists public.student_learning_plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  test_attempt_id uuid references public.certificate_test_attempts(id) on delete set null,
  weak_areas jsonb not null default '[]'::jsonb,
  recommended_lessons jsonb not null default '[]'::jsonb,
  next_lesson jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, course_id)
);

alter table public.student_learning_plans enable row level security;

drop policy if exists "Students view their learning plans" on public.student_learning_plans;
create policy "Students view their learning plans"
on public.student_learning_plans for select to authenticated
using (student_id = (select auth.uid()));

create or replace function public.generate_my_learning_plan(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_attempt record;
  weak_areas jsonb := '[]'::jsonb;
  recommended_lessons jsonb := '[]'::jsonb;
  next_lesson jsonb;
  plan jsonb;
begin
  select attempt.* into latest_attempt
  from public.certificate_test_attempts attempt
  join public.enrollments enrollment on enrollment.course_id = attempt.course_id
    and enrollment.student_id = (select auth.uid())
  where attempt.course_id = p_course_id and attempt.student_id = (select auth.uid())
  order by attempt.attempted_at desc limit 1;

  if not found then
    return jsonb_build_object('course_id', p_course_id, 'weak_areas', '[]'::jsonb, 'recommended_lessons', '[]'::jsonb, 'next_lesson', null);
  end if;

  select coalesce(jsonb_agg(area order by (area->>'missed_questions')::integer desc), '[]'::jsonb)
  into weak_areas
  from (
    select jsonb_build_object(
      'topic', coalesce(nullif(q.value->>'topic', ''), 'Core concepts'),
      'missed_questions', count(*) filter (where coalesce(latest_attempt.answers ->> (q.value->>'id'), '') <> coalesce(q.value->>'correct_option', '')),
      'total_questions', count(*),
      'accuracy', round((count(*) filter (where coalesce(latest_attempt.answers ->> (q.value->>'id'), '') = coalesce(q.value->>'correct_option', ''))::numeric / count(*)::numeric) * 100, 0)
    ) as area
    from public.course_certificate_tests test
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(test.questions -> 0) = 'array'
        then test.questions -> (latest_attempt.attempt_number - 1)
        else test.questions end
    ) q(value)
    where test.id = latest_attempt.test_id
    group by coalesce(nullif(q.value->>'topic', ''), 'Core concepts')
    having count(*) filter (where coalesce(latest_attempt.answers ->> (q.value->>'id'), '') <> coalesce(q.value->>'correct_option', '')) > 0
  ) areas;

  select coalesce(jsonb_agg(jsonb_build_object('title', video.title, 'url', video.video_url, 'topic', matched.topic) order by video.available_at desc), '[]'::jsonb)
  into recommended_lessons
  from public.course_videos video
  cross join lateral (
    select area->>'topic' as topic
    from jsonb_array_elements(weak_areas) area
    where lower(video.title) like '%' || lower(area->>'topic') || '%'
    limit 1
  ) matched
  where video.course_id = p_course_id and video.available_at <= now();

  if jsonb_array_length(recommended_lessons) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object('title', video.title, 'url', video.video_url, 'topic', 'Course review') order by video.available_at desc), '[]'::jsonb)
    into recommended_lessons
    from public.course_videos video
    where video.course_id = p_course_id and video.available_at <= now();
  end if;

  next_lesson := case when jsonb_array_length(recommended_lessons) > 0 then recommended_lessons -> 0 else null end;
  plan := jsonb_build_object(
    'course_id', p_course_id,
    'test_attempt_id', latest_attempt.id,
    'score', latest_attempt.score,
    'passed', latest_attempt.passed,
    'weak_areas', weak_areas,
    'recommended_lessons', recommended_lessons,
    'next_lesson', next_lesson
  );

  insert into public.student_learning_plans (student_id, course_id, test_attempt_id, weak_areas, recommended_lessons, next_lesson, updated_at)
  values ((select auth.uid()), p_course_id, latest_attempt.id, weak_areas, recommended_lessons, next_lesson, now())
  on conflict (student_id, course_id) do update set
    test_attempt_id = excluded.test_attempt_id,
    weak_areas = excluded.weak_areas,
    recommended_lessons = excluded.recommended_lessons,
    next_lesson = excluded.next_lesson,
    updated_at = now();

  return plan;
end;
$$;

grant execute on function public.generate_my_learning_plan(uuid) to authenticated;
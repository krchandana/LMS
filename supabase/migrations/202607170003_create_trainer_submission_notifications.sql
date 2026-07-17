-- Keep a durable, trainer-only notification whenever a learner submits work.
create table if not exists public.trainer_notifications (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  student_id uuid,
  course_id uuid,
  submission_id uuid,
  project_id uuid,
  notification_type text not null check (notification_type in ('assignment_submission', 'project_submission')),
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists trainer_notifications_trainer_created_idx
  on public.trainer_notifications (trainer_id, created_at desc);

alter table public.trainer_notifications enable row level security;

drop policy if exists "Trainers can view their own notifications" on public.trainer_notifications;
create policy "Trainers can view their own notifications"
on public.trainer_notifications for select to authenticated
using (trainer_id = (select auth.uid()));

drop policy if exists "Trainers can mark their own notifications as read" on public.trainer_notifications;
create policy "Trainers can mark their own notifications as read"
on public.trainer_notifications for update to authenticated
using (trainer_id = (select auth.uid()))
with check (trainer_id = (select auth.uid()));

create or replace function public.create_trainer_submission_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_course_id uuid;
  target_trainer_id uuid;
  task_title text;
  student_name text;
  notification_kind text;
  notification_submission_id uuid;
  notification_project_id uuid;
begin
  if TG_TABLE_NAME = 'submissions' then
    select a.course_id, a.title into target_course_id, task_title
    from public.assignments a where a.id = new.assignment_id;
    notification_kind := 'assignment_submission';
    notification_submission_id := new.id;
  else
    target_course_id := new.course_id;
    task_title := new.title;
    notification_kind := 'project_submission';
    notification_project_id := new.id;
  end if;

  select c.trainer_id into target_trainer_id
  from public.courses c where c.id = target_course_id;
  if target_trainer_id is null then return new; end if;

  select p.full_name into student_name
  from public.profiles p where p.id = new.student_id;

  insert into public.trainer_notifications (
    trainer_id, student_id, course_id, submission_id, project_id,
    notification_type, title, body
  ) values (
    target_trainer_id, new.student_id, target_course_id,
    notification_submission_id, notification_project_id,
    notification_kind,
    case when notification_kind = 'project_submission' then 'New project submitted' else 'New assignment submitted' end,
    coalesce(student_name, 'A student') || ' submitted ' || coalesce(task_title, 'work') || ' for review.'
  );
  return new;
end;
$$;

drop trigger if exists trainer_notification_on_submission_insert on public.submissions;
create trigger trainer_notification_on_submission_insert
after insert on public.submissions
for each row
when (new.status = 'submitted')
execute function public.create_trainer_submission_notification();

drop trigger if exists trainer_notification_on_submission_resubmit on public.submissions;
create trigger trainer_notification_on_submission_resubmit
after update of status on public.submissions
for each row
when (new.status = 'submitted' and old.status is distinct from new.status)
execute function public.create_trainer_submission_notification();

drop trigger if exists trainer_notification_on_project on public.projects;
create trigger trainer_notification_on_project
after update of status on public.projects
for each row
when (new.status = 'submitted' and old.status is distinct from new.status)
execute function public.create_trainer_submission_notification();

alter table public.trainer_notifications replica identity full;
alter publication supabase_realtime add table public.trainer_notifications;

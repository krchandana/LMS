-- A student can receive only one certificate for the same course.
-- Keep the first certificate already issued, then remove accidental repeats
-- before enforcing the rule at the database level.
with ranked_certificates as (
  select
    id,
    row_number() over (
      partition by student_id, course_id
      order by issue_date asc nulls last, id asc
    ) as duplicate_rank
  from public.certificates
  where student_id is not null and course_id is not null
)
delete from public.certificates as certificate
using ranked_certificates
where certificate.id = ranked_certificates.id
  and ranked_certificates.duplicate_rank > 1;

create unique index if not exists certificates_one_per_student_course_idx
  on public.certificates (student_id, course_id)
  where student_id is not null and course_id is not null;

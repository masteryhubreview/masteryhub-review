-- 015_official_latest_submitted_results.sql
-- Defines the official/final result as the latest SUBMITTED attempt
-- for each student + reviewer. It never selects the highest score.
-- Existing attempts remain unchanged and stay available in History.

create or replace view public.official_attempt_results
with (security_invoker = true)
as
select
  a.id,
  a.student_id,
  a.reviewer_id,
  a.subject_id,
  a.title,
  a.attempt_number,
  a.status,
  a.score,
  a.max_score,
  a.pending,
  a.started_at,
  a.submitted_at
from (
  select
    attempts.*,
    row_number() over (
      partition by attempts.student_id, attempts.reviewer_id
      order by
        attempts.attempt_number desc,
        attempts.submitted_at desc nulls last,
        attempts.started_at desc
    ) as official_rank
  from public.attempts
  where attempts.status <> 'in_progress'
    and attempts.submitted_at is not null
) a
where a.official_rank = 1;

revoke all on public.official_attempt_results from public, anon;
grant select on public.official_attempt_results to authenticated;

comment on view public.official_attempt_results is
  'Official result per student/reviewer: latest submitted attempt by attempt number. Historical attempts remain in public.attempts.';

-- 017_reset_student_data.sql
-- Admin-only reset for operational/student data.
--
-- DELETES:
-- - student Auth users + student profiles
-- - enrollments
-- - reviewer-to-student assignments
-- - attempts/results/responses stored in attempts
-- - grade audit rows tied to attempts
-- - student notifications + notification dismissals
-- - student announcement dismissals
-- - student device sessions
-- - announcements
-- - student rate-limit rows
--
-- KEEPS:
-- - admin Auth user/profile
-- - system settings / branding
-- - terms / school years / semesters
-- - subjects
-- - questions
-- - reviewers
-- - reviewer rules
-- - reviewer subjects
-- - reviewer questions
--
-- This function is intentionally admin-only and requires an exact
-- confirmation phrase from the UI.

create or replace function public.reset_student_data(
  confirmation_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  student_ids uuid[];
  student_count integer := 0;
  attempt_count integer := 0;
  enrollment_count integer := 0;
  assignment_count integer := 0;
  announcement_count integer := 0;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_admin() then
    raise exception 'Administrator required';
  end if;

  if confirmation_text is distinct from 'RESET DATA' then
    raise exception 'Type RESET DATA exactly to confirm';
  end if;

  -- Capture student IDs before deleting anything.
  select
    coalesce(array_agg(p.id), array[]::uuid[]),
    count(*)::integer
  into student_ids, student_count
  from public.profiles p
  where p.role = 'student';

  select count(*)::integer
  into attempt_count
  from public.attempts a
  where a.student_id = any(student_ids);

  select count(*)::integer
  into enrollment_count
  from public.enrollments e
  where e.student_id = any(student_ids);

  select count(*)::integer
  into assignment_count
  from public.reviewer_students rs
  where rs.student_id = any(student_ids);

  select count(*)::integer
  into announcement_count
  from public.announcements;

  -- Dependent attempt data must be removed before attempts.
  delete from public.grade_audit ga
  where ga.attempt_id in (
    select a.id
    from public.attempts a
    where a.student_id = any(student_ids)
  );

  -- Student communication / per-student state.
  delete from public.student_announcement_dismissals sad
  where sad.student_id = any(student_ids);

  delete from public.student_notification_dismissals snd
  where snd.student_id = any(student_ids);

  delete from public.student_notifications sn
  where sn.student_id = any(student_ids);

  delete from public.student_device_sessions sds
  where sds.student_id = any(student_ids);

  -- Reviewer assignments and subject enrollment.
  delete from public.reviewer_students rs
  where rs.student_id = any(student_ids);

  delete from public.enrollments e
  where e.student_id = any(student_ids);

  -- Attempts include saved responses, grades, score and result history.
  delete from public.attempts a
  where a.student_id = any(student_ids);

  -- Announcements are operational communication data.
  delete from public.announcements;

  -- Remove any stored rate-limit rows belonging to students.
  delete from private.rate_limits rl
  where rl.actor = any(student_ids);

  -- profiles.id references auth.users(id) ON DELETE RESTRICT,
  -- so profiles must be removed before the Auth users.
  delete from public.profiles p
  where p.id = any(student_ids)
    and p.role = 'student';

  delete from auth.users u
  where u.id = any(student_ids);

  return jsonb_build_object(
    'ok', true,
    'students_deleted', student_count,
    'attempts_deleted', attempt_count,
    'enrollments_deleted', enrollment_count,
    'reviewer_assignments_deleted', assignment_count,
    'announcements_deleted', announcement_count
  );
end;
$$;

revoke all on function public.reset_student_data(text)
from public, anon;

grant execute on function public.reset_student_data(text)
to authenticated;

comment on function public.reset_student_data(text) is
'Admin-only destructive reset of student and operational data. Requires exact confirmation text RESET DATA.';

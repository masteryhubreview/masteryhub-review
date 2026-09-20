-- 022_delete_student.sql
--
-- Admin-only permanent deletion of ONE student.
--
-- This allows an administrator to permanently remove a student
-- even when the student has historical reviewer attempts.
--
-- DELETES:
-- - grade audit records tied to the student's attempts
-- - announcement dismissals
-- - notification dismissals
-- - student notifications
-- - device sessions
-- - reviewer assignments
-- - enrollments
-- - attempts / saved responses / scores / result history
-- - student rate-limit records
-- - student profile
--
-- The Auth user is deleted separately by the server API after
-- this database cleanup succeeds.
--
-- KEEPS:
-- - other student accounts
-- - admin accounts
-- - announcements
-- - terms
-- - subjects
-- - questions
-- - reviewers
-- - reviewer rules
-- - reviewer subjects
-- - reviewer questions

create or replace function public.delete_student(
  target_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();

  target_role text;

  attempt_count integer := 0;
  enrollment_count integer := 0;
  assignment_count integer := 0;

begin

  -- ============================================================
  -- SECURITY
  -- ============================================================

  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_admin() then
    raise exception 'Administrator required';
  end if;


  -- ============================================================
  -- VALIDATE TARGET
  -- ============================================================

  select p.role
  into target_role
  from public.profiles p
  where p.id = target_student_id;

  if target_role is null then
    raise exception 'Student not found';
  end if;

  if target_role <> 'student' then
    raise exception 'Target account is not a student';
  end if;


  -- ============================================================
  -- COUNT RECORDS FOR RESPONSE
  -- ============================================================

  select count(*)::integer
  into attempt_count
  from public.attempts a
  where a.student_id = target_student_id;


  select count(*)::integer
  into enrollment_count
  from public.enrollments e
  where e.student_id = target_student_id;


  select count(*)::integer
  into assignment_count
  from public.reviewer_students rs
  where rs.student_id = target_student_id;


  -- ============================================================
  -- DELETE ATTEMPT DEPENDENCIES
  -- ============================================================

  -- Grade audit rows reference attempts, so they must be
  -- removed before the attempts themselves.

  delete from public.grade_audit ga
  where ga.attempt_id in (
    select a.id
    from public.attempts a
    where a.student_id = target_student_id
  );


  -- ============================================================
  -- DELETE STUDENT COMMUNICATION / PER-STUDENT STATE
  -- ============================================================

  delete from public.student_announcement_dismissals sad
  where sad.student_id = target_student_id;


  delete from public.student_notification_dismissals snd
  where snd.student_id = target_student_id;


  delete from public.student_notifications sn
  where sn.student_id = target_student_id;


  delete from public.student_device_sessions sds
  where sds.student_id = target_student_id;


  -- ============================================================
  -- DELETE REVIEWER ASSIGNMENTS
  -- ============================================================

  delete from public.reviewer_students rs
  where rs.student_id = target_student_id;


  -- ============================================================
  -- DELETE ENROLLMENTS
  -- ============================================================

  delete from public.enrollments e
  where e.student_id = target_student_id;


  -- ============================================================
  -- DELETE ATTEMPTS / RESULTS / RESPONSES / HISTORY
  -- ============================================================

  delete from public.attempts a
  where a.student_id = target_student_id;


  -- ============================================================
  -- DELETE RATE-LIMIT DATA
  -- ============================================================

  delete from private.rate_limits rl
  where rl.actor = target_student_id;


  -- ============================================================
  -- DELETE PROFILE
  -- ============================================================

  -- The profile is removed here, but the Auth user is deliberately
  -- NOT deleted inside this RPC.
  --
  -- The server-side /api/students route will delete the Supabase
  -- Auth account afterward using the service-role Admin API.

  delete from public.profiles p
  where p.id = target_student_id
    and p.role = 'student';


  -- ============================================================
  -- RETURN SUMMARY
  -- ============================================================

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'attempts_deleted', attempt_count,
    'enrollments_deleted', enrollment_count,
    'reviewer_assignments_deleted', assignment_count
  );

end;
$$;


-- ============================================================
-- FUNCTION PERMISSIONS
-- ============================================================

revoke all on function public.delete_student(uuid)
from public, anon;


grant execute on function public.delete_student(uuid)
to authenticated;


comment on function public.delete_student(uuid) is
'Admin-only permanent database cleanup for one student, including historical attempts. The student Auth user must be deleted separately by the server API.';
-- 021_reset_student_history.sql
--
-- Admin-only reset of ONE student's reviewer history.
--
-- DELETES:
-- - grade audit rows tied to the student's attempts
-- - attempts, saved responses, grades, scores, and result history
--
-- KEEPS:
-- - student Auth account
-- - student profile
-- - enrollments
-- - reviewer assignments
-- - notifications
-- - subjects / terms
-- - all other student data

create or replace function public.reset_student_history(
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
begin

  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_admin() then
    raise exception 'Administrator required';
  end if;


  -- Confirm that the target exists and is a student.

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


  -- Count attempts before deletion for the response.

  select count(*)::integer
  into attempt_count
  from public.attempts a
  where a.student_id = target_student_id;


  -- Grade audit rows reference attempts and must be deleted first.

  delete from public.grade_audit ga
  where ga.attempt_id in (
    select a.id
    from public.attempts a
    where a.student_id = target_student_id
  );


  -- Attempts contain the student's saved responses,
  -- grades, scores, and result/history records.

  delete from public.attempts a
  where a.student_id = target_student_id;


  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'attempts_deleted', attempt_count
  );

end;
$$;


revoke all on function public.reset_student_history(uuid)
from public, anon;


grant execute on function public.reset_student_history(uuid)
to authenticated;


comment on function public.reset_student_history(uuid) is
'Admin-only reset of one student''s reviewer attempt and result history. Student account, enrollment, and reviewer assignments are preserved.';
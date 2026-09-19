-- 018_delete_subject.sql
-- Admin-only permanent deletion of one subject and records tied to that subject.
-- Student accounts/profiles are NEVER deleted by this function.

create or replace function public.delete_subject(
  target_subject_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  subject_name text;
  attempt_ids uuid[];
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_admin() then
    raise exception 'Administrator required';
  end if;

  select s.name
  into subject_name
  from public.subjects s
  where s.id = target_subject_id;

  if subject_name is null then
    raise exception 'Subject not found';
  end if;

  -- Capture attempts connected to this subject before deleting dependencies.
  select coalesce(array_agg(a.id), array[]::uuid[])
  into attempt_ids
  from public.attempts a
  where a.subject_id = target_subject_id;

  -- Delete audit rows for attempts in this subject.
  delete from public.grade_audit ga
  where ga.attempt_id = any(attempt_ids);

  -- Delete attempts/results/responses for this subject.
  delete from public.attempts a
  where a.subject_id = target_subject_id;

  -- Delete student enrollment links only; student accounts remain.
  delete from public.enrollments e
  where e.subject_id = target_subject_id;

  -- Delete reviewer-to-subject links.
  delete from public.reviewer_subjects rs
  where rs.subject_id = target_subject_id;

  -- Reviewers can also reference the subject directly through reviewers.subject_id.
  -- Delete reviewer-question assignments for those reviewers first, then the reviewers.
  delete from public.reviewer_questions rq
  where rq.reviewer_id in (
    select r.id
    from public.reviewers r
    where r.subject_id = target_subject_id
  );

  delete from public.reviewer_students rs
  where rs.reviewer_id in (
    select r.id
    from public.reviewers r
    where r.subject_id = target_subject_id
  );

  delete from public.reviewers r
  where r.subject_id = target_subject_id;

  -- Delete reviewer-question links for questions owned by this subject first.
  -- reviewer_questions has a foreign key to questions, so these links must
  -- be removed before the underlying questions can be deleted.
  delete from public.reviewer_questions rq
  where rq.question_id in (
    select q.id
    from public.questions q
    where q.subject_id = target_subject_id
  );

  -- Delete questions owned by this subject.
  delete from public.questions q
  where q.subject_id = target_subject_id;

  -- Finally delete the subject itself.
  delete from public.subjects s
  where s.id = target_subject_id;

  return jsonb_build_object(
    'ok', true,
    'subject_id', target_subject_id,
    'subject_name', subject_name
  );
end;
$$;

revoke all on function public.delete_subject(uuid)
from public, anon;

grant execute on function public.delete_subject(uuid)
to authenticated;

comment on function public.delete_subject(uuid) is
'Admin-only permanent deletion of one subject and its subject-linked data. Student accounts are preserved.';

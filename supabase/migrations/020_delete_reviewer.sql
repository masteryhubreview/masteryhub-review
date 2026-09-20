-- 020_delete_reviewer.sql
-- Admin-only permanent deletion of one reviewer.
-- Shared Question Bank questions and student accounts are preserved.
-- Reviewer-specific links are removed transactionally.

create or replace function public.delete_reviewer(
  target_reviewer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  reviewer_title text;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_admin() then
    raise exception 'Administrator required';
  end if;

  select r.title
  into reviewer_title
  from public.reviewers r
  where r.id = target_reviewer_id;

  if reviewer_title is null then
    raise exception 'Reviewer not found';
  end if;

  -- Remove only reviewer-specific relationships.
  -- The underlying Question Bank questions are intentionally preserved.
  delete from public.reviewer_questions rq
  where rq.reviewer_id = target_reviewer_id;

  delete from public.reviewer_students rs
  where rs.reviewer_id = target_reviewer_id;

  delete from public.reviewer_subjects rs
  where rs.reviewer_id = target_reviewer_id;

  delete from public.reviewer_rules rr
  where rr.reviewer_id = target_reviewer_id;

  -- If attempts/results or another table still references this reviewer,
  -- PostgreSQL will reject this statement and roll back everything above.
  delete from public.reviewers r
  where r.id = target_reviewer_id;

  return jsonb_build_object(
    'ok', true,
    'reviewer_id', target_reviewer_id,
    'reviewer_title', reviewer_title
  );
end;
$$;

revoke all on function public.delete_reviewer(uuid)
from public, anon;

grant execute on function public.delete_reviewer(uuid)
to authenticated;

comment on function public.delete_reviewer(uuid) is
'Admin-only reviewer deletion. Preserves student accounts and shared Question Bank questions.';

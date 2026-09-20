-- 019_delete_term.sql
-- Admin-only permanent deletion of one school term.
-- Student accounts/profiles are NEVER deleted by this function.

create or replace function public.delete_term(
  target_term_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  term_name text;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_admin() then
    raise exception 'Administrator required';
  end if;

  select t.name
  into term_name
  from public.terms t
  where t.id = target_term_id;

  if term_name is null then
    raise exception 'School term not found';
  end if;

  -- Keep every student account/profile. Only clear this term assignment.
  update public.profiles p
  set term_id = null
  where p.term_id = target_term_id;

  -- Delete enrollment records that belong specifically to this school term.
  -- Student accounts/profiles and subjects themselves are preserved.
  delete from public.enrollments e
  where e.term_id = target_term_id;

  -- If another table still references this term, PostgreSQL rejects this
  -- statement and rolls back all changes above automatically.
  delete from public.terms t
  where t.id = target_term_id;

  return jsonb_build_object(
    'ok', true,
    'term_id', target_term_id,
    'term_name', term_name
  );
end;
$$;

revoke all on function public.delete_term(uuid)
from public, anon;

grant execute on function public.delete_term(uuid)
to authenticated;

comment on function public.delete_term(uuid) is
'Admin-only permanent deletion of one school term. Student accounts are preserved and direct profiles.term_id references are cleared.';

-- 014_history_access_after_enrollment.sql
-- Keep submitted history accessible after enrollment deactivation.
-- In-progress/new reviewer access remains enrollment-gated.

create or replace function private.require_attempt(a public.attempts)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if a.id is null then
    raise exception 'Attempt not found';
  end if;
  if private.is_admin() then
    return;
  end if;
  if a.student_id <> auth.uid() or not private.is_active() then
    raise exception 'Access denied';
  end if;
  if a.status = 'in_progress' and not private.has_subject(a.subject_id) then
    raise exception 'Access denied';
  end if;
end;
$$;

create or replace function public.my_attempts(page_number integer default 0)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from (
    select a.id,a.title,a.attempt_number,a.status,a.score,a.max_score,
           a.pending,a.started_at,a.submitted_at
    from public.attempts a
    where a.student_id = auth.uid()
      and private.is_active()
      and (a.status <> 'in_progress' or private.has_subject(a.subject_id))
    order by a.started_at desc
    limit 25
    offset greatest(page_number, 0) * 25
  ) t;
$$;

create or replace function private.can_read_image(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or (
      private.is_active()
      and exists (
        select 1
        from public.attempts a,
             jsonb_array_elements(a.snapshot) q
        where a.student_id = auth.uid()
          and q->>'image_path' = path
          and (
            (a.status = 'in_progress' and private.has_subject(a.subject_id))
            or
            (a.status <> 'in_progress'
             and (a.settings->>'allow_review')::boolean)
          )
      )
    );
$$;

revoke all on function private.require_attempt(public.attempts)
  from public, anon, authenticated;
revoke all on function private.can_read_image(text)
  from public, anon, authenticated;
grant execute on function private.can_read_image(text) to authenticated;

revoke all on function public.my_attempts(integer) from public, anon;
grant execute on function public.my_attempts(integer) to authenticated;

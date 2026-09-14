-- 002_multi_subject_reviewers.sql
-- Compatible with the exact ReviewHub schema shared in chat.
-- Run this AFTER the original schema has already been applied.
-- Adds true multi-subject reviewers while keeping reviewers.subject_id
-- as a legacy/primary subject for compatibility with existing attempts.

begin;

-- =========================================================
-- 1. REVIEWER <-> SUBJECT MANY-TO-MANY
-- =========================================================

create table if not exists public.reviewer_subjects(
  reviewer_id uuid not null
    references public.reviewers(id) on delete cascade,
  subject_id uuid not null
    references public.subjects(id) on delete restrict,
  position integer not null default 1,
  primary key(reviewer_id, subject_id)
);

create index if not exists reviewer_subjects_subject
  on public.reviewer_subjects(subject_id, reviewer_id);

-- Preserve all existing reviewers by copying their current subject_id.
insert into public.reviewer_subjects(reviewer_id, subject_id, position)
select id, subject_id, 1
from public.reviewers
on conflict(reviewer_id, subject_id) do nothing;

alter table public.reviewer_subjects enable row level security;

-- Admin can fully manage reviewer-subject links.
drop policy if exists admin_manage on public.reviewer_subjects;
create policy admin_manage
on public.reviewer_subjects
for all
to authenticated
using(private.is_admin())
with check(private.is_admin());

-- =========================================================
-- 2. SAFE REVIEWER ACCESS HELPER
-- =========================================================
-- SECURITY DEFINER prevents circular RLS between reviewers and
-- reviewer_subjects while still checking the student's real enrollment.

create or replace function private.can_access_reviewer(rid uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select private.is_active()
    and exists(
      select 1
      from public.reviewers r
      join public.reviewer_subjects rs
        on rs.reviewer_id = r.id
      where r.id = rid
        and r.published
        and private.has_subject(rs.subject_id)
    )
$$;

-- Students may only see reviewer-subject links for reviewers they can access,
-- and only links matching subjects they themselves are enrolled in.
drop policy if exists student_reviewer_subjects on public.reviewer_subjects;
create policy student_reviewer_subjects
on public.reviewer_subjects
for select
to authenticated
using(
  private.can_access_reviewer(reviewer_id)
  and private.has_subject(subject_id)
);

grant select,insert,update,delete
on public.reviewer_subjects
to authenticated;

-- =========================================================
-- 3. REVIEWER RLS: ANY ASSIGNED SUBJECT
-- =========================================================

drop policy if exists student_reviewers on public.reviewers;

create policy student_reviewers
on public.reviewers
for select
to authenticated
using(private.can_access_reviewer(id));

-- =========================================================
-- 4. REPLACE SAVE_REVIEWER
-- =========================================================
-- The old signature accepted one subject uuid.
-- The new signature accepts subjects uuid[].
--
-- duplicate_reviewer depends on save_reviewer, so remove it first.

drop function if exists public.duplicate_reviewer(uuid);

drop function if exists public.save_reviewer(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  uuid[],
  boolean
);

create function public.save_reviewer(
  reviewer uuid,
  subjects uuid[],
  name text,
  description_text text,
  options jsonb,
  question_ids uuid[],
  publish boolean
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  result uuid := coalesce(reviewer, gen_random_uuid());
  primary_subject uuid;
begin
  if not private.is_admin() then
    raise exception 'Administrator required';
  end if;

  if subjects is null or cardinality(subjects) = 0 then
    raise exception 'Select at least one subject';
  end if;

  if cardinality(subjects) <>
     (select count(distinct x) from unnest(subjects) x) then
    raise exception 'Duplicate subjects';
  end if;

  if exists(
    select 1
    from unnest(subjects) x
    where not exists(
      select 1
      from public.subjects s
      where s.id = x
        and s.is_active
    )
  ) then
    raise exception 'Reviewer subjects must be active';
  end if;

  if question_ids is null then
    question_ids := '{}'::uuid[];
  end if;

  if cardinality(question_ids) <>
     (select count(distinct x) from unnest(question_ids) x) then
    raise exception 'Duplicate pool questions';
  end if;

  if exists(
    select 1
    from unnest(question_ids) x
    where not exists(
      select 1
      from public.questions q
      where q.id = x
        and q.subject_id = any(subjects)
        and q.is_active
    )
  ) then
    raise exception
      'Pool questions must be active and belong to a selected subject';
  end if;

  if publish and (
    cardinality(question_ids) = 0
    or (
      options->>'selection' = 'random'
      and (options->>'count')::int > cardinality(question_ids)
    )
  ) then
    raise exception 'Not enough questions to publish';
  end if;

  primary_subject := subjects[1];

  -- Lock the existing reviewer before replacing links.
  if reviewer is not null then
    perform 1
    from public.reviewers
    where id = reviewer
    for update;

    if not found then
      raise exception 'Reviewer not found';
    end if;

    -- Remove these before changing legacy subject_id so the existing
    -- validate_reviewer trigger does not see a stale question pool.
    delete from public.reviewer_questions
    where reviewer_id = reviewer;

    delete from public.reviewer_subjects
    where reviewer_id = reviewer;
  end if;

  insert into public.reviewers(
    id,
    subject_id,
    title,
    description,
    settings,
    published
  )
  values(
    result,
    primary_subject,
    name,
    description_text,
    options,
    publish
  )
  on conflict(id) do update
  set
    subject_id = excluded.subject_id,
    title = excluded.title,
    description = excluded.description,
    settings = excluded.settings,
    published = excluded.published;

  insert into public.reviewer_subjects(
    reviewer_id,
    subject_id,
    position
  )
  select
    result,
    x,
    ord::int
  from unnest(subjects) with ordinality as t(x, ord);

  insert into public.reviewer_questions(
    reviewer_id,
    question_id,
    position
  )
  select
    result,
    x,
    ord::int
  from unnest(question_ids) with ordinality as t(x, ord);

  return result;
end
$$;

-- =========================================================
-- 5. RECREATE DUPLICATE_REVIEWER
-- =========================================================

create function public.duplicate_reviewer(source uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  r public.reviewers;
  ids uuid[];
  linked_subjects uuid[];
begin
  if not private.is_admin() then
    raise exception 'Administrator required';
  end if;

  select *
  into strict r
  from public.reviewers
  where id = source;

  select array_agg(subject_id order by position)
  into linked_subjects
  from public.reviewer_subjects
  where reviewer_id = source;

  -- Fallback protects reviewers created before this migration.
  if linked_subjects is null or cardinality(linked_subjects) = 0 then
    linked_subjects := array[r.subject_id];
  end if;

  select array_agg(question_id order by position)
  into ids
  from public.reviewer_questions
  where reviewer_id = source;

  return public.save_reviewer(
    null,
    linked_subjects,
    r.title || ' (copy)',
    r.description,
    r.settings,
    coalesce(ids, '{}'::uuid[]),
    false
  );
end
$$;

-- =========================================================
-- 6. REPLACE START_ATTEMPT
-- =========================================================
-- A student can start the reviewer when enrolled in ANY assigned subject.
-- The attempt keeps one subject_id for backwards compatibility:
-- the first assigned subject the current student can actually access.
--
-- For multi-subject reviewers, the snapshot may draw questions from all
-- selected reviewer subjects.

create or replace function public.start_attempt(reviewer uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  r public.reviewers;
  a public.attempts;
  payload jsonb := '[]';
  q jsonb;
  item record;
  n int;
  total numeric := 0;
  new_id uuid;
  limit_n int;
  access_subject uuid;
begin
  if not exists(
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'student'
      and is_active
  ) then
    raise exception 'Active student account required';
  end if;

  -- Serialize concurrent starts for the same student.
  perform 1
  from public.profiles
  where id = auth.uid()
  for update;

  select *
  into r
  from public.reviewers
  where id = reviewer
  for share;

  if r.id is null or not r.published then
    raise exception 'Reviewer unavailable';
  end if;

  -- Student needs access to at least one subject assigned to the reviewer.
  select rs.subject_id
  into access_subject
  from public.reviewer_subjects rs
  where rs.reviewer_id = reviewer
    and private.has_subject(rs.subject_id)
  order by rs.position
  limit 1;

  if access_subject is null then
    raise exception 'Reviewer unavailable';
  end if;

  select *
  into a
  from public.attempts
  where student_id = auth.uid()
    and reviewer_id = reviewer
    and status = 'in_progress';

  if a.id is not null then
    return a.id;
  end if;

  select count(*)::int
  into n
  from public.attempts
  where student_id = auth.uid()
    and reviewer_id = reviewer;

  if r.settings->>'max_attempts' is not null
     and n >= (r.settings->>'max_attempts')::int then
    raise exception 'Attempt limit reached';
  end if;

  limit_n :=
    case
      when r.settings->>'selection' = 'random'
        then (r.settings->>'count')::int
      else null
    end;

  for item in
    select selected.*
    from (
      select
        qb.id,
        qb.data,
        rq.position
      from public.reviewer_questions rq
      join public.questions qb
        on qb.id = rq.question_id
      where rq.reviewer_id = reviewer
        and qb.is_active
        and exists(
          select 1
          from public.reviewer_subjects rs
          where rs.reviewer_id = reviewer
            and rs.subject_id = qb.subject_id
        )
      order by
        case
          when r.settings->>'selection' = 'random'
            then random()
          else rq.position::float8
        end
      limit limit_n
    ) selected
    order by
      case
        when (r.settings->>'shuffle_questions')::boolean
          then random()
        else selected.position::float8
      end
  loop
    q := item.data || jsonb_build_object('id', item.id);

    if (r.settings->>'shuffle_choices')::boolean then
      q := jsonb_set(
        q,
        '{choices}',
        coalesce(
          (
            select jsonb_agg(x order by random())
            from jsonb_array_elements(q->'choices') x
          ),
          '[]'
        )
      );
    end if;

    payload := payload || jsonb_build_array(q);
    total := total + (q->>'points')::numeric;
  end loop;

  if jsonb_array_length(payload) = 0
     or (
       limit_n is not null
       and jsonb_array_length(payload) < limit_n
     ) then
    raise exception 'Not enough active questions';
  end if;

  insert into public.attempts(
    student_id,
    reviewer_id,
    subject_id,
    title,
    attempt_number,
    settings,
    snapshot,
    max_score
  )
  values(
    auth.uid(),
    reviewer,
    access_subject,
    r.title,
    n + 1,
    r.settings,
    payload,
    total
  )
  returning id into new_id;

  return new_id;
end
$$;

-- =========================================================
-- 7. FUNCTION PERMISSIONS
-- =========================================================

revoke all on function private.can_access_reviewer(uuid)
from public,anon,authenticated;

grant execute on function private.can_access_reviewer(uuid)
to authenticated;

revoke all on function public.save_reviewer(
  uuid,
  uuid[],
  text,
  text,
  jsonb,
  uuid[],
  boolean
)
from public,anon;

grant execute on function public.save_reviewer(
  uuid,
  uuid[],
  text,
  text,
  jsonb,
  uuid[],
  boolean
)
to authenticated;

revoke all on function public.duplicate_reviewer(uuid)
from public,anon;

grant execute on function public.duplicate_reviewer(uuid)
to authenticated;

revoke all on function public.start_attempt(uuid)
from public,anon;

grant execute on function public.start_attempt(uuid)
to authenticated;

commit;

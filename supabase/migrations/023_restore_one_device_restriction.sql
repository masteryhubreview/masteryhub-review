-- 008_one_device_per_student.sql
-- One active device per STUDENT account.
-- Admin accounts are not restricted.
--
-- Flow:
-- 1. First student device claims the account.
-- 2. A second device receives "conflict".
-- 3. "Continue on this device" forces takeover.
-- 4. The previous device becomes invalid and is signed out by the app.

create table if not exists public.student_device_sessions (
  student_id uuid primary key
    references public.profiles(id) on delete cascade,
  device_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.student_device_sessions enable row level security;

-- No direct client table access is needed.
revoke all on table public.student_device_sessions from anon, authenticated;

create or replace function public.claim_student_device(
  device_token text,
  force_takeover boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_role text;
  current_active boolean;
  existing_token text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if device_token is null or length(trim(device_token)) < 8 then
    raise exception 'Invalid device token';
  end if;

  select p.role::text, p.is_active
    into current_role, current_active
  from public.profiles p
  where p.id = current_user_id;

  if current_role is null then
    raise exception 'Profile not found';
  end if;

  if not current_active then
    raise exception 'Account is inactive';
  end if;

  -- Admins and any non-student roles are intentionally unrestricted.
  if current_role <> 'student' then
    return 'not_student';
  end if;

  select s.device_token
    into existing_token
  from public.student_device_sessions s
  where s.student_id = current_user_id
  for update;

  if existing_token is null then
    insert into public.student_device_sessions (
      student_id,
      device_token,
      updated_at
    )
    values (
      current_user_id,
      trim(device_token),
      now()
    )
    on conflict (student_id) do nothing;

    select s.device_token
      into existing_token
    from public.student_device_sessions s
    where s.student_id = current_user_id;

    if existing_token = trim(device_token) then
      return 'claimed';
    end if;
  end if;

  if existing_token = trim(device_token) then
    update public.student_device_sessions
    set updated_at = now()
    where student_id = current_user_id;

    return 'active';
  end if;

  if force_takeover then
    update public.student_device_sessions
    set
      device_token = trim(device_token),
      updated_at = now()
    where student_id = current_user_id;

    return 'taken_over';
  end if;

  return 'conflict';
end;
$$;

create or replace function public.release_student_device(
  device_token text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    return false;
  end if;

  delete from public.student_device_sessions
  where student_id = current_user_id
    and student_device_sessions.device_token = trim(release_student_device.device_token);

  return found;
end;
$$;

revoke all on function public.claim_student_device(text, boolean)
from public, anon;

revoke all on function public.release_student_device(text)
from public, anon;

grant execute on function public.claim_student_device(text, boolean)
to authenticated;

grant execute on function public.release_student_device(text)
to authenticated;

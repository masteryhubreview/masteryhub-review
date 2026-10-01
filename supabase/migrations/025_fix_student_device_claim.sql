-- 025_fix_student_device_claim.sql
-- Fix one-device-per-student claim logic.
-- Uses unambiguous parameter names.

drop function if exists public.claim_student_device(text, boolean);

create or replace function public.claim_student_device(
  p_device_token text,
  p_force_takeover boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_role text;
  v_active boolean;
  v_existing_token text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_device_token is null or length(trim(p_device_token)) < 8 then
    raise exception 'Invalid device token';
  end if;

  select
    p.role::text,
    p.is_active
  into
    v_role,
    v_active
  from public.profiles as p
  where p.id = v_user_id;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_active is not true then
    raise exception 'Account is inactive';
  end if;

  -- Admin and other non-student accounts remain unrestricted.
  if v_role is distinct from 'student' then
    return 'not_student';
  end if;

  select s.device_token
  into v_existing_token
  from public.student_device_sessions as s
  where s.student_id = v_user_id
  for update;

  -- No device has claimed this student account yet.
  if not found then
    insert into public.student_device_sessions (
      student_id,
      device_token,
      updated_at
    )
    values (
      v_user_id,
      trim(p_device_token),
      now()
    )
    on conflict (student_id) do nothing;

    select s.device_token
    into v_existing_token
    from public.student_device_sessions as s
    where s.student_id = v_user_id;

    if v_existing_token = trim(p_device_token) then
      return 'claimed';
    end if;
  end if;

  -- This is already the registered device.
  if v_existing_token = trim(p_device_token) then
    update public.student_device_sessions
    set updated_at = now()
    where student_id = v_user_id;

    return 'active';
  end if;

  -- Another device owns the account.
  if p_force_takeover then
    update public.student_device_sessions
    set
      device_token = trim(p_device_token),
      updated_at = now()
    where student_id = v_user_id;

    return 'taken_over';
  end if;

  return 'conflict';
end;
$$;

revoke all on function public.claim_student_device(text, boolean)
from public, anon;

grant execute on function public.claim_student_device(text, boolean)
to authenticated;
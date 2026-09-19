-- 011_notifications_announcements.sql
-- Separate student announcements from reviewer notifications and allow
-- notifications to be dismissed persistently per student.
--
-- This migration is intentionally additive. It does not modify the
-- one-device / realtime functions from migrations 008-010.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  expires_at timestamptz null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_active_published_idx
  on public.announcements (is_active, published_at desc);

create table if not exists public.student_notification_dismissals (
  student_id uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid not null,
  dismissed_at timestamptz not null default now(),
  primary key (student_id, notification_id)
);

alter table public.announcements enable row level security;
alter table public.student_notification_dismissals enable row level security;

drop policy if exists "students can read active announcements"
  on public.announcements;

create policy "students can read active announcements"
on public.announcements
for select
to authenticated
using (
  is_active
  and published_at <= now()
  and (expires_at is null or expires_at > now())
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'student'
      and p.is_active
  )
);

drop policy if exists "admins can manage announcements"
  on public.announcements;

create policy "admins can manage announcements"
on public.announcements
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active
  )
);

drop policy if exists "students can read own notification dismissals"
  on public.student_notification_dismissals;

create policy "students can read own notification dismissals"
on public.student_notification_dismissals
for select
to authenticated
using (
  student_id = auth.uid()
);

drop policy if exists "students can create own notification dismissals"
  on public.student_notification_dismissals;

create policy "students can create own notification dismissals"
on public.student_notification_dismissals
for insert
to authenticated
with check (
  student_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'student'
      and p.is_active
  )
);

grant select on table public.announcements to authenticated;
grant select, insert on table public.student_notification_dismissals to authenticated;

create or replace function public.my_announcements()
returns table (
  id uuid,
  title text,
  message text,
  published_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.title,
    a.message,
    a.published_at,
    a.expires_at
  from public.announcements a
  where a.is_active
    and a.published_at <= now()
    and (a.expires_at is null or a.expires_at > now())
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'student'
        and p.is_active
    )
  order by a.published_at desc, a.created_at desc
  limit 10;
$$;

grant execute on function public.my_announcements() to authenticated;

create or replace function public.dismiss_notification(notification uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'student'
      and p.is_active
  ) then
    raise exception 'Active student account required';
  end if;

  insert into public.student_notification_dismissals (
    student_id,
    notification_id
  )
  values (
    auth.uid(),
    notification
  )
  on conflict (student_id, notification_id) do nothing;
end;
$$;

grant execute on function public.dismiss_notification(uuid) to authenticated;

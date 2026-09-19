-- 013_announcement_dismissals.sql
-- Allows each student to dismiss announcements persistently.

create table if not exists public.student_announcement_dismissals (
  student_id uuid not null references public.profiles(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (student_id, announcement_id)
);

alter table public.student_announcement_dismissals enable row level security;

drop policy if exists "students can read own announcement dismissals"
  on public.student_announcement_dismissals;

create policy "students can read own announcement dismissals"
on public.student_announcement_dismissals
for select
to authenticated
using (student_id = auth.uid());

drop policy if exists "students can create own announcement dismissals"
  on public.student_announcement_dismissals;

create policy "students can create own announcement dismissals"
on public.student_announcement_dismissals
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

grant select, insert on table public.student_announcement_dismissals to authenticated;

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
    and (
      a.target_subject is null
      or exists (
        select 1
        from public.enrollments e
        where e.student_id = auth.uid()
          and e.subject_id = a.target_subject
          and e.is_active
      )
    )
    and not exists (
      select 1
      from public.student_announcement_dismissals d
      where d.student_id = auth.uid()
        and d.announcement_id = a.id
    )
  order by a.published_at desc, a.created_at desc
  limit 10;
$$;

grant execute on function public.my_announcements() to authenticated;

create or replace function public.dismiss_announcement(announcement uuid)
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

  if not exists (
    select 1
    from public.announcements a
    where a.id = announcement
      and a.is_active
      and a.published_at <= now()
      and (a.expires_at is null or a.expires_at > now())
      and (
        a.target_subject is null
        or exists (
          select 1
          from public.enrollments e
          where e.student_id = auth.uid()
            and e.subject_id = a.target_subject
            and e.is_active
        )
      )
  ) then
    raise exception 'Announcement is not available';
  end if;

  insert into public.student_announcement_dismissals (
    student_id,
    announcement_id
  )
  values (auth.uid(), announcement)
  on conflict (student_id, announcement_id) do nothing;
end;
$$;

grant execute on function public.dismiss_announcement(uuid) to authenticated;

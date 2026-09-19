-- 012_announcement_subject_targeting.sql
-- Adds optional subject targeting to the announcement system created in 011.

alter table public.announcements
  add column if not exists target_subject uuid null
  references public.subjects(id) on delete set null;

create index if not exists announcements_target_subject_idx
  on public.announcements (target_subject);

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
  order by a.published_at desc, a.created_at desc
  limit 10;
$$;

grant execute on function public.my_announcements() to authenticated;

create or replace function public.send_announcement(
  target_subject uuid,
  announcement_title text,
  announcement_message text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_count integer;
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active
  ) then
    raise exception 'Active admin account required';
  end if;

  if nullif(btrim(announcement_title), '') is null then
    raise exception 'Announcement title is required';
  end if;

  if nullif(btrim(announcement_message), '') is null then
    raise exception 'Announcement message is required';
  end if;

  if target_subject is not null
     and not exists (
       select 1
       from public.subjects s
       where s.id = target_subject
         and s.is_active
     ) then
    raise exception 'Selected subject is not active';
  end if;

  insert into public.announcements (
    title,
    message,
    target_subject,
    is_active,
    published_at,
    created_by
  )
  values (
    btrim(announcement_title),
    btrim(announcement_message),
    target_subject,
    true,
    now(),
    auth.uid()
  );

  if target_subject is null then
    select count(*)::integer
    into recipient_count
    from public.profiles p
    where p.role = 'student'
      and p.is_active;
  else
    select count(distinct e.student_id)::integer
    into recipient_count
    from public.enrollments e
    join public.profiles p
      on p.id = e.student_id
    where e.subject_id = target_subject
      and e.is_active
      and p.role = 'student'
      and p.is_active;
  end if;

  return coalesce(recipient_count, 0);
end;
$$;

grant execute on function public.send_announcement(uuid, text, text)
  to authenticated;

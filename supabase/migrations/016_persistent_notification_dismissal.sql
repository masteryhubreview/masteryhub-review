-- 016_persistent_notification_dismissal.sql
-- Fix notification dismissal persistence.
-- dismiss_notification() stores dismissed notification IDs in
-- student_notification_dismissals, so my_notifications() must exclude them.

create or replace function public.my_notifications()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(to_jsonb(n) order by n.created_at desc),
    '[]'::jsonb
  )
  from (
    select
      sn.id,
      sn.reviewer_id,
      sn.title,
      sn.message,
      sn.created_at,
      sn.read_at
    from public.student_notifications sn
    where sn.student_id = auth.uid()
      and sn.read_at is null
      and sn.dismissed_at is null
      and not exists (
        select 1
        from public.student_notification_dismissals d
        where d.student_id = auth.uid()
          and d.notification_id = sn.id
      )
    order by sn.created_at desc
    limit 10
  ) n;
$$;

revoke all on function public.my_notifications() from public, anon;
grant execute on function public.my_notifications() to authenticated;

-- 010_student_device_realtime.sql
-- Near-real-time sign-out of an old student device after a takeover.
-- Requires 008_one_device_per_student.sql.
--
-- The student may read ONLY their own current device-session row so
-- Supabase Realtime can deliver the ownership-change event.

grant select on table public.student_device_sessions to authenticated;

drop policy if exists "student can read own device session"
on public.student_device_sessions;

create policy "student can read own device session"
on public.student_device_sessions
for select
to authenticated
using (
  student_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'student'
      and p.is_active
  )
);

-- Add the table to the Supabase Realtime publication only if needed.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'student_device_sessions'
  ) then
    alter publication supabase_realtime
      add table public.student_device_sessions;
  end if;
end;
$$;

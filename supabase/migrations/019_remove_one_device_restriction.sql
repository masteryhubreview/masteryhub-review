-- 019_remove_one_device_restriction.sql
-- Removes the one-device-per-student restriction.
-- Students may sign in from multiple devices.
-- This does not change account status checks, authentication,
-- reviewer attempt limits, or other access controls.

drop function if exists public.claim_student_device(text, boolean);

drop function if exists public.release_student_device(text);

drop table if exists public.student_device_sessions;
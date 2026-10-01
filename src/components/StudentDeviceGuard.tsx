'use client';

import { useEffect } from 'react';
import { db } from '@/lib/supabase';

const DEVICE_TOKEN_KEY = 'reviewhub_student_device_token';

function getDeviceToken() {
  let token = localStorage.getItem(DEVICE_TOKEN_KEY);

  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }

  return token;
}

export default function StudentDeviceGuard() {
  useEffect(() => {
    const client = db();

    let disposed = false;
    let signingOut = false;
    let channel: ReturnType<typeof client.channel> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const signOutOldDevice = async () => {
      if (disposed || signingOut) return;

      signingOut = true;

      try {
        // IMPORTANT:
        // Only sign out THIS browser/device.
        // Do not invalidate the new device that took ownership.
        await client.auth.signOut({ scope: 'local' });
      } catch (error) {
        console.warn('Local device sign-out failed:', error);
      }

      if (disposed) return;

      window.location.replace(
        '/?device_signed_out=1',
      );
    };

    const startGuard = async () => {
      const {
        data: { session },
      } = await client.auth.getSession();

      if (disposed || !session?.user?.id) return;

      const userId = session.user.id;

      // Confirm this account is actually an active student.
      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('role, is_active')
        .eq('id', userId)
        .maybeSingle();

      if (
        disposed ||
        profileError ||
        !profile ||
        profile.role !== 'student' ||
        !profile.is_active
      ) {
        return;
      }

      const myDeviceToken = getDeviceToken();

      const verifyOwnership = async () => {
        if (disposed || signingOut) return;

        const {
          data: { session: currentSession },
        } = await client.auth.getSession();

        if (
          disposed ||
          signingOut ||
          !currentSession?.user?.id
        ) {
          return;
        }

        const { data: deviceSession, error } = await client
          .from('student_device_sessions')
          .select('device_token')
          .eq('student_id', userId)
          .maybeSingle();

        if (disposed || signingOut) return;

        if (error) {
          console.warn(
            'Student device ownership check failed:',
            error.message,
          );
          return;
        }

        // No row yet = don't kick the student out.
        if (!deviceSession?.device_token) return;

        if (deviceSession.device_token !== myDeviceToken) {
          await signOutOldDevice();
        }
      };

      // REALTIME — fastest path.
      channel = client
        .channel(`global-student-device-${userId}-${myDeviceToken}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'student_device_sessions',
            filter: `student_id=eq.${userId}`,
          },
          () => {
            void verifyOwnership();
          },
        )
        .subscribe((status) => {
          console.log('GLOBAL DEVICE GUARD:', status);

          if (status === 'SUBSCRIBED') {
            void verifyOwnership();
          }
        });

      // FALLBACK — ensures takeover still works if Realtime misses an event.
      interval = setInterval(() => {
        void verifyOwnership();
      }, 3000);

      const onFocus = () => {
        void verifyOwnership();
      };

      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          void verifyOwnership();
        }
      };

      window.addEventListener('focus', onFocus);
      document.addEventListener(
        'visibilitychange',
        onVisibilityChange,
      );

      // Run immediately.
      await verifyOwnership();

      return () => {
        window.removeEventListener('focus', onFocus);
        document.removeEventListener(
          'visibilitychange',
          onVisibilityChange,
        );
      };
    };

    let removePageListeners:
      | (() => void)
      | undefined;

    void startGuard().then((cleanup) => {
      if (cleanup) {
        removePageListeners = cleanup;
      }
    });

    return () => {
      disposed = true;

      removePageListeners?.();

      if (interval) {
        clearInterval(interval);
      }

      if (channel) {
        void client.removeChannel(channel);
      }
    };
  }, []);

  return null;
}
'use client';

import { useEffect } from 'react';
import { db } from '@/lib/supabase';

const STUDENT_DEVICE_TOKEN_KEY = 'masteryhub:student-device-token';

function studentDeviceToken() {
  if (typeof window === 'undefined') return '';

  const existing = window.localStorage.getItem(
    STUDENT_DEVICE_TOKEN_KEY,
  );

  if (existing) return existing;

  const token =
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  window.localStorage.setItem(
    STUDENT_DEVICE_TOKEN_KEY,
    token,
  );

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
        await client.auth.signOut({ scope: 'local' });
      } catch (error) {
        console.warn('Local device sign-out failed:', error);
      }

      if (disposed) return;

      window.location.replace('/?device_signed_out=1');
    };

    const startGuard = async () => {
      const {
        data: { session },
      } = await client.auth.getSession();

      if (disposed || !session?.user?.id) return;

      const userId = session.user.id;

      const { data: profile, error: profileError } =
        await client
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

      const myDeviceToken = studentDeviceToken();

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

        const { data: deviceSession, error } =
          await client
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

        if (!deviceSession?.device_token) return;

        if (
          deviceSession.device_token !== myDeviceToken
        ) {
          await signOutOldDevice();
        }
      };

      channel = client
        .channel(
          `global-student-device-${userId}-${myDeviceToken}`,
        )
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
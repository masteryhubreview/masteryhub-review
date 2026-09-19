'use client';

import { useState } from 'react';
import { db, rpc } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { Notice, errorText } from './shared';

export default function Account({ profile }: { profile: Profile }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const isStudent = profile.role === 'student';

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PROFILE</span>
          <h1>Account settings</h1>
          <p>
            {isStudent
              ? 'View your account details and update your password.'
              : 'Keep your sign-in details up to date.'}
          </p>
        </div>
      </div>

      <form
        className="panel narrow stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage('');

          const form = new FormData(event.currentTarget);

          try {
            const password = String(form.get('password') || '');

            if (isStudent) {
              if (!password) {
                setMessage('Enter a new password to make a change.');
                return;
              }

              const { error } = await db().auth.updateUser({ password });
              if (error) throw error;

              setMessage('Password updated successfully.');
              event.currentTarget.reset();
              return;
            }

            await rpc('set_display_name', {
              new_name: form.get('display_name'),
            });

            const email = String(form.get('email') || '');

            const { error } = await db().auth.updateUser({
              ...(email && email !== profile.email ? { email } : {}),
              ...(password ? { password } : {}),
            });

            if (error) throw error;

            setMessage(
              'Saved. Email changes may require confirmation in both inboxes.',
            );
          } catch (error) {
            setMessage(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {isStudent ? (
          <>
            <div className="account-readonly-field">
              <span>Display name</span>
              <strong>{profile.display_name}</strong>
              <small>Managed by your administrator</small>
            </div>

            <div className="account-readonly-field">
              <span>Email address</span>
              <strong>{profile.email}</strong>
              <small>Managed by your administrator</small>
            </div>

            <div className="account-password-divider">
              <div>
                <strong>Change password</strong>
                <small>
                  Use at least 12 characters for your new password.
                </small>
              </div>
            </div>

            <label>
              New password
              <input
                name="password"
                type="password"
                minLength={12}
                autoComplete="new-password"
                placeholder="Enter a new password"
              />
            </label>

            <button disabled={busy}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </>
        ) : (
          <>
            <label>
              Display name
              <input
                name="display_name"
                defaultValue={profile.display_name}
                maxLength={120}
                required
              />
            </label>

            <label>
              Email address
              <input
                name="email"
                type="email"
                defaultValue={profile.email}
                required
              />
            </label>

            <label>
              New password
              <input
                name="password"
                type="password"
                minLength={12}
                autoComplete="new-password"
                placeholder="Leave blank to keep current password"
              />
            </label>

            <button disabled={busy}>
              {busy ? 'Saving…' : 'Save account settings'}
            </button>
          </>
        )}

        <Notice message={message} />
      </form>
    </>
  );
}

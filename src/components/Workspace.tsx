'use client';

import { useEffect, useRef, useState } from 'react';
import { db, rpc } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import Admin from './admin/Admin';
import Student from './Student';
import Account from './Account';
import { ImageAttachment, Notice, errorText } from './shared';

export type Branding = {
  system_name: string;
  tagline: string;
  welcome: string;
  instructions: string;
  logo_path: string | null;
};

export const initialBranding: Branding = {
  system_name: 'ReviewHub',
  tagline: 'Learn. Practice. Improve.',
  welcome:
    'Welcome to ReviewHub! Select one of your enrolled subjects to start reviewing.',
  instructions:
    'Take your time. Review each question carefully, and keep practicing.',
  logo_path: null,
};

function withTimeout<T>(promise: PromiseLike<T>, ms = 7000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('Connection timed out. Please try again.')),
      ms,
    );

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const ADMIN_PHONE_MAX_WIDTH = 700;
const LAST_WORKSPACE_TAB_KEY = 'masteryhub:last-workspace-tab';
const STUDENT_DEVICE_TOKEN_KEY = 'masteryhub:student-device-token';

function studentDeviceToken() {
  if (typeof window === 'undefined') return '';

  const existing = window.localStorage.getItem(STUDENT_DEVICE_TOKEN_KEY);
  if (existing) return existing;

  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  window.localStorage.setItem(STUDENT_DEVICE_TOKEN_KEY, token);
  return token;
}

function storedWorkspaceTab() {
  if (typeof window === 'undefined') return 'Dashboard';
  return window.sessionStorage.getItem(LAST_WORKSPACE_TAB_KEY) || 'Dashboard';
}

function isPhoneViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= ADMIN_PHONE_MAX_WIDTH;
}

export default function Workspace() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branding, setBranding] = useState(initialBranding);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState(() => storedWorkspaceTab());
  const [busy, setBusy] = useState(false);
  const [authView, setAuthView] = useState<'home' | 'signin'>('home');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isPhone, setIsPhone] = useState(() => isPhoneViewport());
  const [deviceConflict, setDeviceConflict] = useState(false);
  const forcedDeviceSignOutRef = useRef(false);

  useEffect(() => {
    const syncPhone = () => setIsPhone(isPhoneViewport());
    syncPhone();
    window.addEventListener('resize', syncPhone);
    return () => window.removeEventListener('resize', syncPhone);
  }, []);

  useEffect(() => {
    let live = true;

    async function load() {
      if (!live) return;

      try {
        const {
          data: { session },
          error: sessionError,
        } = await withTimeout(db().auth.getSession());

        if (!live) return;
        if (sessionError) throw sessionError;

        if (!session?.user) {
          setProfile(null);
          setMessage('');
          return;
        }

        const { data, error } = await withTimeout(
          db().from('profiles').select('*').eq('id', session.user.id).single(),
        );

        if (!live) return;
        if (error) throw error;

        if (!data.is_active) {
          await db().auth.signOut();
          if (!live) return;
          setProfile(null);
          setAuthView('signin');
          setMessage('Your account is inactive. Contact the administrator.');
          return;
        }

        if (data.role === 'student') {
          const deviceStatus = await withTimeout(
            rpc<string>('claim_student_device', {
              device_token: studentDeviceToken(),
              force_takeover: false,
            }),
          );

          if (!live) return;

          if (deviceStatus === 'conflict') {
            setProfile(null);
            setDeviceConflict(true);
            setMessage('');
            return;
          }
        }

        setDeviceConflict(false);
        setProfile(data);

        const allowedTabs =
          data.role === 'admin'
            ? ['Dashboard', 'Students', 'Quiz & Reviewers', 'Results', 'Settings']
            : ['Dashboard', 'History', 'Account'];

        const savedTab = storedWorkspaceTab();
        const restoredTab = allowedTabs.includes(savedTab)
          ? savedTab
          : 'Dashboard';

        setTab(restoredTab);
        window.sessionStorage.setItem(LAST_WORKSPACE_TAB_KEY, restoredTab);

        const { data: b } = await withTimeout(
          db().from('settings').select('*').eq('id', 1).single(),
        );

        if (!live) return;
        if (b) setBranding(b);
      } catch (e) {
        if (!live) return;
        setProfile(null);
        setMessage(errorText(e));
      } finally {
        if (live) setLoading(false);
      }
    }

    load();

    const {
      data: { subscription },
    } = db().auth.onAuthStateChange((event) => {
      if (!live) return;

      if (event === 'SIGNED_OUT') {
        const forcedByAnotherDevice = forcedDeviceSignOutRef.current;
        forcedDeviceSignOutRef.current = false;

        setProfile(null);
        setDeviceConflict(false);
        setTab('Dashboard');
        window.sessionStorage.removeItem(LAST_WORKSPACE_TAB_KEY);
        setAuthView(forcedByAnotherDevice ? 'signin' : 'home');

        if (forcedByAnotherDevice) {
          setMessage(
            'This student account was continued on another device. Please sign in again if you want to use this device.',
          );
        }

        setLoading(false);
        return;
      }

      if (
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED'
      ) {
        setLoading(true);
        window.setTimeout(load, 0);
      }
    });

    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profile || profile.role !== 'student') return;

    let active = true;
    let checking = false;

    const forceLocalDeviceSignOut = async () => {
      if (!active || forcedDeviceSignOutRef.current) return;

      forcedDeviceSignOutRef.current = true;
      await db().auth.signOut({ scope: 'local' });
    };

    const validateDevice = async () => {
      if (!active || checking) return;
      checking = true;

      try {
        const status = await rpc<string>('claim_student_device', {
          device_token: studentDeviceToken(),
          force_takeover: false,
        });

        if (!active) return;

        if (status === 'conflict') {
          await forceLocalDeviceSignOut();
        }
      } catch {
        // Keep the current page during a temporary network/database error.
      } finally {
        checking = false;
      }
    };

    // Validate immediately instead of waiting for the first interval.
    void validateDevice();

    const channel = db()
      .channel(`student-device-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'student_device_sessions',
          filter: `student_id=eq.${profile.id}`,
        },
        (payload) => {
          const row = (payload.new || {}) as {
            device_token?: string;
          };

          if (
            row.device_token &&
            row.device_token !== studentDeviceToken()
          ) {
            void forceLocalDeviceSignOut();
          }
        },
      )
      .subscribe();

    const onFocus = () => void validateDevice();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void validateDevice();
      }
    };

    // Fallback in case Realtime is temporarily unavailable.
    const timer = window.setInterval(() => {
      void validateDevice();
    }, 10000);

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      void db().removeChannel(channel);
    };
  }, [profile?.id, profile?.role]);

  if (loading) {
    return (
      <main className="auth-wrap">
        <p>Opening ReviewHub...</p>
      </main>
    );
  }

  if (deviceConflict) {
    return (
      <>
        <main className="auth-wrap auth-responsive-shell">
          <section className="auth-card">
            <div className="auth-logo-wrap">
              <img
                className="auth-logo"
                src="/masteryhub-review-logo.png"
                alt="MasteryHub Review"
              />
            </div>

            <span className="eyebrow">STUDENT ACCOUNT</span>
            <h2>Already signed in on another device</h2>

            <p>
              This student account currently has another active device.
              Only one device can use a student account at a time.
            </p>

            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setMessage('');

                try {
                  const status = await withTimeout(
                    rpc<string>('claim_student_device', {
                      device_token: studentDeviceToken(),
                      force_takeover: true,
                    }),
                  );

                  if (
                    status !== 'taken_over' &&
                    status !== 'active' &&
                    status !== 'claimed'
                  ) {
                    throw new Error(
                      'Unable to continue on this device. Please try again.',
                    );
                  }

                  setDeviceConflict(false);
                  window.location.reload();
                } catch (e) {
                  setMessage(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Switching device…' : 'Continue on this device'}
            </button>

            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={async () => {
                await db().auth.signOut({ scope: 'local' });
                setDeviceConflict(false);
                setProfile(null);
                setAuthView('signin');
              }}
            >
              Go back
            </button>

            <Notice message={message} />

            <p className="caption">
              Continuing here will sign out the previous device automatically.
            </p>
          </section>
        </main>

        <footer className="public-auth-footer">
          <span className="footer-watermark">
            <span className="footer-powered-by">Powered by</span>{' '}
            <span className="footer-brand-name">
              TCL Systems &amp; Digitals PH
            </span>
          </span>
        </footer>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <main className="auth-wrap auth-responsive-shell">
          {/* DESKTOP: original all-in-one layout */}
          <section className="auth-story desktop-auth-only">
            <span className="eyebrow">YOUR SPACE TO GROW</span>

            <h1>
              Small steps.
              <br />
              Brighter futures.
            </h1>

            <p>
              A focused place to learn, practice, and build confidence. One
              question at a time.
            </p>

            <div className="orbit">
              <span>Learn</span>
              <span>Practice</span>
              <span>Improve</span>
            </div>

            <p className="caption">REVIEW HUB / STUDENT LEARNING SPACE</p>
          </section>

          <form
            className="auth-card desktop-auth-only"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage('');

              const f = new FormData(e.currentTarget);

              try {
                const { error } = await withTimeout(
                  db().auth.signInWithPassword({
                    email: String(f.get('email')),
                    password: String(f.get('password')),
                  }),
                );

                if (error) throw error;
              } catch (e) {
                setMessage(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="auth-logo-wrap">
              <img
                className="auth-logo"
                src="/masteryhub-review-logo.png"
                alt="MasteryHub Review"
              />
            </div>

            <h2>Welcome back.</h2>
            <p>Sign in to your learning space.</p>

            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>

            <button disabled={busy}>
              {busy ? 'Signing in...' : 'Sign in'}
            </button>

            <button
              type="button"
              className="text-button"
              onClick={async (e) => {
                const form = e.currentTarget.form!;
                const email = String(new FormData(form).get('email'));

                if (!email) {
                  setMessage('Enter your email address first.');
                  return;
                }

                try {
                  const { error } = await withTimeout(
                    db().auth.resetPasswordForEmail(email, {
                      redirectTo: location.origin + '/reset',
                    }),
                  );

                  if (error) throw error;

                  setMessage(
                    'If the account exists, a reset link will arrive by email.',
                  );
                } catch (e) {
                  setMessage(errorText(e));
                }
              }}
            >
              Forgot password?
            </button>

            <Notice message={message} />

            <p className="caption">
              Accounts are provided by your administrator. Public registration
              is not available.
            </p>
          </form>

          {/* MOBILE: public homepage first */}
          {authView === 'home' ? (
            <section className="auth-card public-home-card mobile-auth-only">
              <span className="eyebrow public-home-eyebrow">
                WELCOME TO MASTERYHUB REVIEW
              </span>

              <h2 className="public-home-title">
                Ready to continue learning?
              </h2>

              <p className="public-home-copy">
                Access your assigned subjects, reviewers, quizzes, scores, and
                learning history using the account provided by your
                administrator.
              </p>

              <div className="orbit public-home-orbit">
                <span>Review</span>
                <span>Practice</span>
                <span>Progress</span>
              </div>

              <button
                type="button"
                className="public-home-student-signin"
                onClick={() => {
                  setMessage('');
                  setAuthView('signin');
                }}
              >
                Student Sign In
              </button>

              <p className="caption public-home-note">
                Private learning access only. Accounts are created by the
                administrator.
              </p>
            </section>
          ) : (
            <form
              className="auth-card mobile-auth-only mobile-signin-card"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setMessage('');

                const f = new FormData(e.currentTarget);

                try {
                  const { error } = await withTimeout(
                    db().auth.signInWithPassword({
                      email: String(f.get('email')),
                      password: String(f.get('password')),
                    }),
                  );

                  if (error) throw error;
                } catch (e) {
                  setMessage(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="auth-logo-wrap">
                <img
                  className="auth-logo"
                  src="/masteryhub-review-logo.png"
                  alt="MasteryHub Review"
                />
              </div>

              <h2>Welcome back.</h2>
              <p>Sign in to your learning space.</p>

              <label>
                Email address
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  required
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                />
              </label>

              <button disabled={busy}>
                {busy ? 'Signing in...' : 'Sign in'}
              </button>

              <button
                type="button"
                className="text-button"
                onClick={async (e) => {
                  const form = e.currentTarget.form!;
                  const email = String(new FormData(form).get('email'));

                  if (!email) {
                    setMessage('Enter your email address first.');
                    return;
                  }

                  try {
                    const { error } = await withTimeout(
                      db().auth.resetPasswordForEmail(email, {
                        redirectTo: location.origin + '/reset',
                      }),
                    );

                    if (error) throw error;

                    setMessage(
                      'If the account exists, a reset link will arrive by email.',
                    );
                  } catch (e) {
                    setMessage(errorText(e));
                  }
                }}
              >
                Forgot password?
              </button>

              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMessage('');
                  setAuthView('home');
                }}
              >
                ← Back to Home
              </button>

              <Notice message={message} />

              <p className="caption">
                Accounts are provided by your administrator. Public registration
                is not available.
              </p>
            </form>
          )}
        </main>

        <footer className="public-auth-footer">
          <span className="footer-watermark">
            <span className="footer-powered-by">Powered by</span>{' '}
            <span className="footer-brand-name">
              TCL Systems &amp; Digitals PH
            </span>
          </span>
        </footer>
      </>
    );
  }

  if (profile.role === 'admin' && isPhone) {
    return (
      <main className="admin-phone-block">
        <section className="admin-phone-block-card">
          <span className="eyebrow">ADMIN ACCESS</span>
          <h1>Please use a larger device</h1>
          <p>
            The Admin Dashboard is available on tablet, iPad, laptop, and desktop only.
            Admin access is not available on mobile phones.
          </p>
          <button
            type="button"
            onClick={async () => {
              await db().auth.signOut();
              setProfile(null);
              setTab('Dashboard');
              window.sessionStorage.removeItem(LAST_WORKSPACE_TAB_KEY);
              setAuthView('home');
            }}
          >
            Back to Student Sign In
          </button>
        </section>
      </main>
    );
  }

  const tabs =
    profile.role === 'admin'
      ? ['Dashboard', 'Students', 'Quiz & Reviewers', 'Results', 'Settings']
      : ['Dashboard', 'History', 'Account'];

  const signOut = async () => {
    setMobileNavOpen(false);

    if (profile.role === 'student') {
      try {
        await rpc('release_student_device', {
          device_token: studentDeviceToken(),
        });
      } catch {
        // Sign out locally even if the release request cannot be completed.
      }
    }

    await db().auth.signOut({ scope: 'local' });
    setProfile(null);
    setDeviceConflict(false);
    setTab('Dashboard');
    window.sessionStorage.removeItem(LAST_WORKSPACE_TAB_KEY);
    setAuthView('home');
  };

  const chooseTab = (nextTab: string) => {
    setTab(nextTab);
    window.sessionStorage.setItem(LAST_WORKSPACE_TAB_KEY, nextTab);
    setMessage('');
    setMobileNavOpen(false);
  };

  return (
    <div
      className={`workspace ${
        profile.role === 'student' ? 'student-workspace' : 'admin-workspace'
      }`}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark small">
            R<span>h</span>
          </div>

          <div>
            <strong>{branding.system_name}</strong>
            <small>
              {profile.role === 'admin'
                ? 'ADMIN WORKSPACE'
                : 'STUDENT WORKSPACE'}
            </small>
          </div>
        </div>

        <ImageAttachment path={branding.logo_path} bucket="branding" />

        <nav aria-label="Main navigation">
          {tabs.map((t, i) => (
            <button
              key={t}
              className={'nav-item ' + (tab === t ? 'active' : '')}
              onClick={() => chooseTab(t)}
            >
              <span className="nav-index">
                {String(i + 1).padStart(2, '0')}
              </span>
              {t}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <p>{branding.tagline}</p>
          <span className="pill">
            {profile.role === 'admin'
              ? 'Manage with care'
              : 'A little progress, every day'}
          </span>
        </div>
      </aside>

      <>
          <div
            className={`student-mobile-backdrop ${
              mobileNavOpen ? 'open' : ''
            }`}
            aria-hidden={!mobileNavOpen}
            onClick={() => setMobileNavOpen(false)}
          />

          <aside
            className={`student-mobile-drawer ${
              mobileNavOpen ? 'open' : ''
            }`}
            aria-hidden={!mobileNavOpen}
            aria-label={`${profile.role === 'admin' ? 'Admin' : 'Student'} mobile navigation`}
          >
            <div className="student-mobile-drawer-head">
              <div>
                <span className="student-mobile-kicker">MASTERYHUB REVIEW</span>
                <strong>{profile.display_name}</strong>
                <small>
                  {profile.role === 'admin' ? 'Admin workspace' : 'Student workspace'}
                </small>
              </div>

              <button
                type="button"
                className="student-mobile-close"
                aria-label="Close menu"
                onClick={() => setMobileNavOpen(false)}
              >
                ×
              </button>
            </div>

            <nav
              className="student-mobile-menu"
              aria-label={profile.role === 'admin' ? 'Admin navigation' : 'Student navigation'}
            >
              {tabs.map((t) => {
                const descriptions: Record<string, string> = {
                  Dashboard:
                    profile.role === 'admin'
                      ? 'Overview and quick actions'
                      : 'Your subjects and reviewers',
                  Students: 'Students, enrollment and subjects',
                  'Quiz & Reviewers': 'Reviewers and question bank',
                  Results: 'Attempts, scores and grading',
                  Settings: 'System settings and account',
                  History: 'Past attempts and results',
                  Account: 'Profile and password',
                };

                const icons: Record<string, string> = {
                  Dashboard: '⌂',
                  Students: '◎',
                  'Quiz & Reviewers': '◇',
                  Results: '✓',
                  Settings: '⚙',
                  History: '↻',
                  Account: '○',
                };

                return (
                  <button
                    key={t}
                    type="button"
                    className={tab === t ? 'active' : ''}
                    onClick={() => chooseTab(t)}
                  >
                    <span>{icons[t] || '•'}</span>
                    <div>
                      <strong>{t}</strong>
                      <small>{descriptions[t] || t}</small>
                    </div>
                  </button>
                );
              })}
            </nav>

            <div className="student-mobile-drawer-foot">
              <button
                type="button"
                className="student-mobile-signout"
                onClick={signOut}
              >
                Sign out
              </button>

              <span>
                Powered by <b>TCL Systems &amp; Digitals PH</b>
              </span>
            </div>
          </aside>
        </>

      <div className="main">
        <header className="topbar">
          <div className="student-mobile-topbar">
              <button
                type="button"
                className="student-mobile-burger"
                aria-label="Open menu"
                aria-expanded={mobileNavOpen}
                onClick={() => setMobileNavOpen(true)}
              >
                <span />
                <span />
                <span />
              </button>

              <div className="student-mobile-brand">
                <strong>{branding.system_name}</strong>
                <small>{tab}</small>
              </div>

              <span className="student-mobile-avatar">
                {profile.display_name.charAt(0)}
              </span>
            </div>

          <span className="breadcrumb">
            Workspace / <b>{tab}</b>
          </span>

          <div className="user">
            <span className="avatar">{profile.display_name.charAt(0)}</span>
            <span>{profile.display_name}</span>

            <button className="ghost" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <main className="content">
          <Notice message={message} />

          {tab === 'Account' ? (
            <Account profile={profile} />
          ) : profile.role === 'admin' ? (
            <Admin
              tab={tab}
              profile={profile}
              branding={branding}
              onBranding={setBranding}
            />
          ) : (
            <Student tab={tab} profile={profile} branding={branding} />
          )}
        </main>

        <footer>
          <span className="footer-watermark">
            <span className="footer-powered-by">Powered by</span>{' '}
            <span className="footer-brand-name">
              TCL Systems &amp; Digitals PH
            </span>
          </span>
        </footer>
      </div>
    </div>
  );
}

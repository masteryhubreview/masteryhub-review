'use client';

import { useEffect, useState } from 'react';
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

        setProfile(data);

        const { data: b } = await withTimeout(
          db().from('settings').select('*').eq('id', 1).single(),
        );

        if (!live) return;
        if (b) setBranding(b);

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
        setProfile(null);
        setTab('Dashboard');
        window.sessionStorage.removeItem(LAST_WORKSPACE_TAB_KEY);
        setAuthView('home');
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


  if (loading) {
    return (
      <main className="auth-wrap">
        <p>Opening ReviewHub...</p>
      </main>
    );
  }

  if (!profile) {
    const openPublicHome = () => {
      setMessage('');
      setMobileNavOpen(false);
      setAuthView('home');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const openPublicSignIn = () => {
      setMessage('');
      setMobileNavOpen(false);
      setAuthView('signin');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const signInForm = (
      <form
        className="auth-card public-signin-card"
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

        <span className="eyebrow">WELCOME BACK</span>
        <h2>Sign in to continue.</h2>
        <p>Access your assigned reviewers, quizzes, scores, and learning history.</p>

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
          Accounts are provided by your administrator. Public registration is not
          available.
        </p>
      </form>
    );

    return (
      <div className="public-landing-shell">
        <header className="public-landing-header">
          <button
            type="button"
            className="public-brand-button ghost"
            onClick={openPublicHome}
            aria-label="MasteryHub Review home"
          >
            <img
              src="/masteryhub-review-logo.png"
              alt="MasteryHub Review"
              className="public-header-logo"
            />
          </button>

          <nav className="public-desktop-nav" aria-label="Public navigation">
            <button
              type="button"
              className={`ghost ${authView === 'home' ? 'active' : ''}`}
              onClick={openPublicHome}
            >
              Home
            </button>
            <button
              type="button"
              className={`ghost ${authView === 'signin' ? 'active' : ''}`}
              onClick={openPublicSignIn}
            >
              Sign In
            </button>
          </nav>

          <button
            type="button"
            className="public-mobile-menu-button ghost"
            aria-label="Open menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>

          {mobileNavOpen && (
            <nav className="public-mobile-nav" aria-label="Mobile public navigation">
              <button
                type="button"
                className={`ghost ${authView === 'home' ? 'active' : ''}`}
                onClick={openPublicHome}
              >
                Home
              </button>
              <button
                type="button"
                className={`ghost ${authView === 'signin' ? 'active' : ''}`}
                onClick={openPublicSignIn}
              >
                Sign In
              </button>
            </nav>
          )}
        </header>

        {authView === 'home' ? (
          <main className="public-landing-main">
            <section className="public-landing-hero">
              <div className="public-landing-copy">
                <span className="eyebrow">WELCOME TO MASTERYHUB REVIEW</span>

                <h1>
                  Review smarter.
                  <br />
                  Progress with confidence.
                </h1>

                <p>
                  Your focused learning space for assigned reviewers, practice
                  quizzes, results, and progress — all in one place.
                </p>

                <button
                  type="button"
                  className="public-start-review"
                  onClick={openPublicSignIn}
                >
                  Start Your Review <span aria-hidden="true">→</span>
                </button>

                <div className="public-landing-words" aria-label="Review Practice Progress">
                  <span>Review</span>
                  <span>Practice</span>
                  <span>Progress</span>
                </div>
              </div>

              <div className="public-landing-visual" aria-hidden="true">
                <div className="public-landing-orbit public-orbit-one" />
                <div className="public-landing-orbit public-orbit-two" />
                <div className="public-landing-note">
                  <span>YOUR LEARNING SPACE</span>
                  <strong>
                    A little practice.
                    <br />
                    A lot of possibility.
                  </strong>
                  <small>Learn at your own pace.</small>
                </div>
              </div>
            </section>
          </main>
        ) : (
          <main className="public-signin-main">
            <section className="public-signin-intro">
              <span className="eyebrow">MASTERYHUB REVIEW</span>
              <h1>Welcome back.</h1>
              <p>
                Sign in using the account provided by your administrator to
                continue your review.
              </p>

              <div className="public-landing-words">
                <span>Review</span>
                <span>Practice</span>
                <span>Progress</span>
              </div>
            </section>

            {signInForm}
          </main>
        )}

        <footer className="public-auth-footer public-landing-footer">
          <span className="footer-watermark">
            <span className="footer-powered-by">Powered by</span>{' '}
            <span className="footer-brand-name">
              TCL Systems &amp; Digitals PH
            </span>
          </span>
        </footer>
      </div>
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
    await db().auth.signOut({ scope: 'local' });
    setProfile(null);
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
        <ImageAttachment path={branding.logo_path} bucket="branding" />

        <div className="brand sidebar-brand-text">
          <div>
            <strong>{branding.system_name}</strong>
            <small>
              {profile.role === 'admin'
                ? 'ADMIN WORKSPACE'
                : 'STUDENT WORKSPACE'}
            </small>
          </div>
        </div>

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
              <div className="student-mobile-drawer-brand">
                <div className="student-mobile-drawer-logo">
                  <ImageAttachment path={branding.logo_path} bucket="branding" />
                </div>
                <div className="student-mobile-drawer-copy">
                  <span className="student-mobile-kicker">MASTERYHUB REVIEW</span>
                  <strong>{profile.display_name}</strong>
                  <small>
                    {profile.role === 'admin' ? 'Admin workspace' : 'Student workspace'}
                  </small>
                </div>
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
                <div className="student-mobile-brand-copy">
                  <strong>{branding.system_name}</strong>
                  <small>{tab}</small>
                </div>
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

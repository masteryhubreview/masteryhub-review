'use client';

import { useEffect, useRef, useState } from 'react';
import type { Profile, Subject, Reviewer } from '@/lib/types';
import { db, rpc } from '@/lib/supabase';
import type { Branding } from './Workspace';
import { Notice, Pager, errorText } from './shared';
import Quiz from './Quiz';

const STUDENT_DEVICE_TOKEN_KEY = 'masteryhub:student-device-token';
const STUDENT_ACTIVE_ATTEMPT_KEY = 'masteryhub:active-attempt';

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


type ReviewerRuleSummary = {
  reviewer_id: string;
  time_limit_minutes: number | null;
  access_code_enabled: boolean;
  show_correct_from: string | null;
  hide_correct_at: string | null;
  available_from: string | null;
  available_until: string | null;
  due_at: string | null;
};

type ReviewerAttemptStatus = {
  reviewer_id: string;
  attempt_count: number;
  in_progress_id: string | null;
};

type StudentNotification = {
  id: string;
  reviewer_id: string | null;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

type StudentAnnouncement = {
  id: string;
  title: string;
  message: string;
  published_at: string;
  expires_at: string | null;
};

type History = {
  id: string;
  title: string;
  status: string;
  score: number;
  max_score: number;
  pending: number;
  attempt_number: number;
  started_at: string;
};

export default function Student({
  tab,
  profile,
  branding,
  onTabChange,
}: {
  tab: string;
  profile: Profile;
  branding: Branding;
  onTabChange: (tab: string) => void;
}) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reviewerSubjects, setReviewerSubjects] = useState<
    Record<string, string[]>
  >({});
  const [history, setHistory] = useState<History[]>([]);
  const [reviewerRules, setReviewerRules] = useState<
    Record<string, ReviewerRuleSummary>
  >({});
  const [notifications, setNotifications] = useState<StudentNotification[]>([]);
  const [announcements, setAnnouncements] = useState<StudentAnnouncement[]>([]);
  const [attemptStatuses, setAttemptStatuses] = useState<
    Record<string, ReviewerAttemptStatus>
  >({});
  const [subject, setSubject] = useState('');
  const [reviewerSort, setReviewerSort] = useState<'date-newest' | 'date-oldest' | 'az' | 'za'>('date-newest');
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(STUDENT_ACTIVE_ATTEMPT_KEY);
  });
  const intentionallyClosedAttemptRef = useRef(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeReviewer, setCodeReviewer] = useState<Reviewer | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [accessCodeError, setAccessCodeError] = useState('');
  const [retryReviewer, setRetryReviewer] = useState<Reviewer | null>(null);

  useEffect(() => {
    setPage(0);
  }, [tab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (attempt) {
      window.localStorage.setItem(STUDENT_ACTIVE_ATTEMPT_KEY, attempt);
    } else {
      window.localStorage.removeItem(STUDENT_ACTIVE_ATTEMPT_KEY);
    }
  }, [attempt]);

  useEffect(() => {
    let live = true;

    async function load() {
      try {
        if (tab === 'History') {
          const data = await rpc<History[]>('my_attempts', {
            page_number: page,
          });

          if (live) setHistory(data);
          return;
        }

        const { data: subjectRows, error: subjectError } = await db()
          .from('subjects')
          .select('*')
          .order('name')
          .range(0, 999);

        if (subjectError) throw subjectError;
        if (!live) return;

        const availableSubjects = subjectRows || [];
        setSubjects(availableSubjects);

        let allowedReviewerIds: string[] | null = null;

        if (subject) {
          const { data: links, error: linksError } = await db()
            .from('reviewer_subjects')
            .select('reviewer_id')
            .eq('subject_id', subject);

          if (linksError) throw linksError;

          allowedReviewerIds = Array.from(
            new Set((links || []).map((item) => item.reviewer_id)),
          );

          if (!allowedReviewerIds.length) {
            setReviewers([]);
            setReviewerSubjects({});
            return;
          }
        }

        let reviewerQuery = db()
          .from('reviewers')
          .select('*');

        if (allowedReviewerIds) {
          reviewerQuery = reviewerQuery.in('id', allowedReviewerIds);
        }

        if (reviewerSort === 'az') {
          reviewerQuery = reviewerQuery.order('title', { ascending: true });
        } else if (reviewerSort === 'za') {
          reviewerQuery = reviewerQuery.order('title', { ascending: false });
        } else {
          reviewerQuery = reviewerQuery.order('created_at', {
            ascending: reviewerSort === 'date-oldest',
          });
        }

        reviewerQuery = reviewerQuery.range(page * 15, page * 15 + 14);

        const { data: reviewerRows, error: reviewerError } =
          await reviewerQuery;

        if (reviewerError) throw reviewerError;

        let currentReviewers = (reviewerRows || []) as Reviewer[];

        const [ruleRows, notificationRows, announcementRows, attemptStatusRows] =
          await Promise.all([
            rpc<ReviewerRuleSummary[]>('my_reviewer_rules'),
            rpc<StudentNotification[]>('my_notifications'),
            rpc<StudentAnnouncement[]>('my_announcements'),
            rpc<ReviewerAttemptStatus[]>(
              'my_reviewer_attempt_statuses',
            ),
          ]);

        const ruleMap: Record<string, ReviewerRuleSummary> = {};
        for (const rule of ruleRows || []) {
          ruleMap[rule.reviewer_id] = rule;
        }

        const attemptMap: Record<string, ReviewerAttemptStatus> = {};
        for (const status of attemptStatusRows || []) {
          attemptMap[status.reviewer_id] = status;
        }

        // Always surface unfinished reviewers on the current Dashboard page.
        // This keeps a reviewer with an active attempt visible immediately after
        // "Back to Workspace", even if normal sorting/pagination placed it later.
        const inProgressReviewerIds = Object.values(attemptMap)
          .filter((status) => !!status?.in_progress_id)
          .map((status) => status.reviewer_id)
          .filter(
            (reviewerId) =>
              !allowedReviewerIds || allowedReviewerIds.includes(reviewerId),
          );

        const missingInProgressIds = inProgressReviewerIds.filter(
          (reviewerId) =>
            !currentReviewers.some((reviewer) => reviewer.id === reviewerId),
        );

        if (missingInProgressIds.length) {
          const { data: inProgressRows, error: inProgressError } = await db()
            .from('reviewers')
            .select('*')
            .in('id', missingInProgressIds);

          if (inProgressError) throw inProgressError;

          currentReviewers = [
            ...((inProgressRows || []) as Reviewer[]),
            ...currentReviewers,
          ];
        }

        currentReviewers = [
          ...currentReviewers.filter(
            (reviewer) => !!attemptMap[reviewer.id]?.in_progress_id,
          ),
          ...currentReviewers.filter(
            (reviewer) => !attemptMap[reviewer.id]?.in_progress_id,
          ),
        ];

        const ids = currentReviewers.map((item) => item.id);

        let links: { reviewer_id: string; subject_id: string }[] = [];

        if (ids.length) {
          const { data: linkRows, error: linkError } = await db()
            .from('reviewer_subjects')
            .select('reviewer_id,subject_id')
            .in('reviewer_id', ids);

          if (linkError) throw linkError;
          links = linkRows || [];
        }

        const map: Record<string, string[]> = {};
        for (const link of links) {
          map[link.reviewer_id] ||= [];
          map[link.reviewer_id].push(link.subject_id);
        }

        if (live) {
          setReviewers(currentReviewers);
          setReviewerSubjects(map);
          setReviewerRules(ruleMap);
          setNotifications(notificationRows || []);
          setAnnouncements(announcementRows || []);
          setAttemptStatuses(attemptMap);

        }
      } catch (error) {
        if (live) setMessage(errorText(error));
      }
    }

    load();

    return () => {
      live = false;
    };
  }, [tab, subject, page, attempt, reviewerSort]);

  if (attempt) {
    return (
      <Quiz
        id={attempt}
        logoPath={branding.logo_path}
        onClose={() => {
          intentionallyClosedAttemptRef.current = true;
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(STUDENT_ACTIVE_ATTEMPT_KEY);
          }
          onTabChange('Dashboard');
          setAttempt(null);
        }}
      />
    );
  }

  const subjectName = (id: string) =>
    subjects.find((item) => item.id === id)?.name;

  const subjectLabel = (id: string) => {
    const item = subjects.find((subjectItem) => subjectItem.id === id) as
      | (Subject & { code?: string | null })
      | undefined;

    if (!item) return '';
    return item.code ? `${item.name} - ${item.code}` : item.name;
  };

  function reviewerAvailability(reviewerId: string) {
    const rules = reviewerRules[reviewerId];
    const now = Date.now();

    if (
      rules?.available_from &&
      now < new Date(rules.available_from).getTime()
    ) {
      return {
        blocked: true,
        label: `Available ${new Date(
          rules.available_from,
        ).toLocaleString()}`,
      };
    }

    if (
      rules?.available_until &&
      now >= new Date(rules.available_until).getTime()
    ) {
      return {
        blocked: true,
        label: 'Availability ended',
      };
    }

    return { blocked: false, label: '' };
  }

  function reviewerAttemptState(reviewer: Reviewer) {
    const status = attemptStatuses[reviewer.id];
    const maxAttempts = reviewer.settings.max_attempts;
    const completedAttempts = status?.attempt_count || 0;

    if (status?.in_progress_id) {
      return {
        exhausted: false,
        inProgressId: status.in_progress_id,
        completedAttempts,
        nextAttemptNumber: completedAttempts + 1,
        label: 'Resume reviewer',
      };
    }

    if (maxAttempts !== null && completedAttempts >= maxAttempts) {
      return {
        exhausted: true,
        inProgressId: null,
        completedAttempts,
        nextAttemptNumber: completedAttempts + 1,
        label: 'Attempt limit reached',
      };
    }

    return {
      exhausted: false,
      inProgressId: null,
      completedAttempts,
      nextAttemptNumber: completedAttempts + 1,
      label:
        completedAttempts > 0
          ? `Take Attempt ${completedAttempts + 1}`
          : 'Start reviewer',
    };
  }

  async function beginReviewer(
    reviewer: Reviewer,
    code: string | null = null,
  ) {
    setBusy(true);
    setMessage('');

    try {
      const attemptId = await rpc<string>('device_start_attempt', {
        reviewer: reviewer.id,
        access_code: code,
        device_token: studentDeviceToken(),
      });

      setCodeReviewer(null);
      setAccessCode('');
      setAccessCodeError('');
      intentionallyClosedAttemptRef.current = false;
    setAttempt(attemptId);
    } catch (error) {
      const text = errorText(error);

      if (reviewerRules[reviewer.id]?.access_code_enabled) {
        setAccessCodeError(text);
      } else {
        setMessage(text);
      }
    } finally {
      setBusy(false);
    }
  }

  async function startReviewer(reviewer: Reviewer) {
    const rules = reviewerRules[reviewer.id];
    const availability = reviewerAvailability(reviewer.id);
    const attemptState = reviewerAttemptState(reviewer);

    if (attemptState.exhausted) return;

    if (attemptState.inProgressId) {
      intentionallyClosedAttemptRef.current = false;
      setAttempt(attemptState.inProgressId);
      return;
    }

    if (availability.blocked) {
      setMessage(availability.label);
      return;
    }

    // A completed attempt must never silently create the next attempt.
    if (attemptState.completedAttempts > 0) {
      setRetryReviewer(reviewer);
      return;
    }

    if (rules?.access_code_enabled) {
      setAccessCode('');
      setAccessCodeError('');
      setCodeReviewer(reviewer);
      return;
    }

    await beginReviewer(reviewer, null);
  }

  async function confirmNextAttempt() {
    if (!retryReviewer || busy) return;

    const reviewer = retryReviewer;
    const rules = reviewerRules[reviewer.id];

    setRetryReviewer(null);

    if (rules?.access_code_enabled) {
      setAccessCode('');
      setAccessCodeError('');
      setCodeReviewer(reviewer);
      return;
    }

    await beginReviewer(reviewer, null);
  }

  async function submitAccessCode() {
    if (!codeReviewer || busy) return;

    const code = accessCode.trim();

    if (!code) {
      setAccessCodeError('Enter the reviewer access code.');
      return;
    }

    setAccessCodeError('');
    await beginReviewer(codeReviewer, code);
  }

  async function dismissAnnouncement(announcementId: string) {
    const dismissed = announcements.find((item) => item.id === announcementId);
    setAnnouncements((current) =>
      current.filter((item) => item.id !== announcementId),
    );

    try {
      await rpc('dismiss_announcement', {
        announcement: announcementId,
      });
    } catch (error) {
      if (dismissed) {
        setAnnouncements((current) => {
          if (current.some((item) => item.id === dismissed.id)) return current;
          return [dismissed, ...current].sort(
            (a, b) =>
              new Date(b.published_at).getTime() -
              new Date(a.published_at).getTime(),
          );
        });
      }
      setMessage(errorText(error));
    }
  }

  async function dismissNotification(notificationId: string) {
    // Remove it immediately for a responsive UI, then restore it if persistence fails.
    const dismissed = notifications.find((item) => item.id === notificationId);
    setNotifications((current) =>
      current.filter((item) => item.id !== notificationId),
    );

    try {
      await rpc('dismiss_notification', {
        notification: notificationId,
      });
    } catch (error) {
      if (dismissed) {
        setNotifications((current) => {
          if (current.some((item) => item.id === dismissed.id)) return current;
          return [dismissed, ...current].sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime(),
          );
        });
      }
      setMessage(errorText(error));
    }
  }

  const sortedReviewers = reviewers;

  return (
    <>
      <Notice message={message} />

      {retryReviewer && (
        <div
          className="reviewer-code-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget || busy) return;
            setRetryReviewer(null);
          }}
        >
          <div
            className="reviewer-code-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reviewer-retry-title"
          >
            <div className="reviewer-code-heading">
              <div>
                <span className="eyebrow">ANOTHER ATTEMPT</span>
                <h2 id="reviewer-retry-title">Start another attempt?</h2>
                <p>{retryReviewer.title}</p>
              </div>
              <span
                role="button"
                tabIndex={0}
                className="reviewer-code-close"
                aria-label="Close"
                onClick={() => !busy && setRetryReviewer(null)}
              >
                ×
              </span>
            </div>

            <p style={{ marginTop: 12 }}>
              You already completed Attempt {attemptStatuses[retryReviewer.id]?.attempt_count || 1}.
              Starting again will create Attempt {(attemptStatuses[retryReviewer.id]?.attempt_count || 1) + 1}.
              Your latest submitted attempt will be used as your final graded attempt.
            </p>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => setRetryReviewer(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmNextAttempt()}
              >
                {busy ? 'Starting…' : `Start Attempt ${(attemptStatuses[retryReviewer.id]?.attempt_count || 1) + 1}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {codeReviewer && (
        <div
          className="reviewer-code-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget || busy) return;
            setCodeReviewer(null);
            setAccessCode('');
            setAccessCodeError('');
          }}
        >
          <div
            className="reviewer-code-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reviewer-code-title"
          >
            <div className="reviewer-code-heading">
              <div>
                <span className="eyebrow">PRIVATE REVIEWER</span>
                <h2 id="reviewer-code-title">Enter access code</h2>
                <p>{codeReviewer.title}</p>
              </div>

              <span
                role="button"
                tabIndex={0}
                className="reviewer-code-close"
                aria-label="Close access code"
                onClick={() => {
                  if (busy) return;
                  setCodeReviewer(null);
                  setAccessCode('');
                  setAccessCodeError('');
                }}
                onKeyDown={(event) => {
                  if (
                    !busy &&
                    (event.key === 'Enter' || event.key === ' ')
                  ) {
                    event.preventDefault();
                    setCodeReviewer(null);
                    setAccessCode('');
                    setAccessCodeError('');
                  }
                }}
              >
                ×
              </span>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitAccessCode();
              }}
            >
              <label>
                Access code
                <input
                  autoFocus
                  type="password"
                  autoComplete="off"
                  value={accessCode}
                  onChange={(event) => {
                    setAccessCode(event.target.value);
                    if (accessCodeError) setAccessCodeError('');
                  }}
                  placeholder="Enter code"
                  disabled={busy}
                />
              </label>

              {accessCodeError && (
                <div className="reviewer-code-error">
                  {accessCodeError}
                </div>
              )}

              <div className="reviewer-code-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    setCodeReviewer(null);
                    setAccessCode('');
                    setAccessCodeError('');
                  }}
                >
                  Cancel
                </button>

                <button type="submit" disabled={busy}>
                  {busy ? 'Checking…' : 'Continue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 600px) {
          .student-reviewer-filters {
            width: 100% !important;
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
            gap: 8px !important;
            align-items: end !important;
          }

          .student-reviewer-filter {
            min-width: 0 !important;
            width: 100% !important;
          }

          .student-reviewer-filter select {
            width: 100% !important;
            min-width: 0 !important;
          }
        }
      `}</style>

      {tab === 'Dashboard' ? (
        <>
          <section className="hero">
            <div>
              <span className="eyebrow">WELCOME TO MASTERYHUB REVIEW! YOUR NEXT CHAPTER STARTS HERE</span>
              <h1>Hello, {profile.display_name.split(' ')[0]}.</h1>
              <p>{branding.welcome}</p>
              <span className="pill">Learn at your own pace</span>
            </div>

            <div className="hero-art" aria-hidden="true">
              <div className="paper">
                A little
                <br />
                <b>practice.</b>
                <hr />
                A lot of
                <br />
                <b>possibility.</b>
                <span>✦</span>
              </div>
            </div>
          </section>

          {!!announcements.length && (
            <section
              className="student-announcements"
              style={{
                marginBottom: 18,
                padding: 18,
                borderRadius: 16,
                background: '#fff4f8',
                border: '1px solid #f2d9e4',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 10,
                }}
              >
                <div>
                  <span className="eyebrow">ANNOUNCEMENT</span>
                  <h2 style={{ margin: '3px 0 0' }}>
                    {announcements.length === 1 ? 'Announcement' : 'Announcements'}
                  </h2>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                {announcements.map((announcement) => (
                  <article
                    key={announcement.id}
                    style={{
                      position: 'relative',
                      background: '#fff',
                      border: '1px solid #eadde4',
                      borderRadius: 12,
                      padding: '14px 46px 14px 14px',
                    }}
                  >
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Dismiss ${announcement.title}`}
                      title="Dismiss"
                      onClick={() => void dismissAnnouncement(announcement.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void dismissAnnouncement(announcement.id);
                        }
                      }}
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 10,
                        display: 'block',
                        padding: 0,
                        margin: 0,
                        color: '#dc2626',
                        fontSize: 16,
                        fontWeight: 700,
                        lineHeight: 1,
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      ×
                    </span>

                    <strong>{announcement.title}</strong>
                    <p style={{ margin: '5px 0 8px', whiteSpace: 'pre-wrap' }}>
                      {announcement.message}
                    </p>
                    <time style={{ fontSize: 11, opacity: 0.7 }}>
                      {new Date(announcement.published_at).toLocaleString()}
                    </time>
                  </article>
                ))}
              </div>
            </section>
          )}

          {!!notifications.length && (
            <section className="student-notifications">
              <div className="student-notifications-heading">
                <h2>Notifications</h2>
                <span>{notifications.length}</span>
              </div>

              <div className="student-notification-list">
                {notifications.slice(0, 5).map((notification) => (
                  <div
                    className={`student-notification-item ${
                      notification.read_at ? '' : 'unread'
                    }`}
                    key={notification.id}
                    onClick={() => {
                      if (notification.read_at) return;

                      void rpc('mark_notification_read', {
                        notification: notification.id,
                      });

                      setNotifications((current) =>
                        current.map((item) =>
                          item.id === notification.id
                            ? {
                                ...item,
                                read_at: new Date().toISOString(),
                              }
                            : item,
                        ),
                      );
                    }}
                    style={{
                      position: 'relative',
                      paddingRight: 42,
                    }}
                  >
                    <div>
                      <strong>{notification.title}</strong>
                      <p>{notification.message}</p>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <time>
                        {new Date(notification.created_at).toLocaleString()}
                      </time>

                      <button
                        type="button"
                        className="ghost"
                        aria-label={`Dismiss ${notification.title}`}
                        title="Dismiss"
                        onClick={(event) => {
                          event.stopPropagation();
                          void dismissNotification(notification.id);
                        }}
                        style={{
                          minWidth: 28,
                          width: 28,
                          height: 28,
                          padding: 0,
                          borderRadius: 999,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="section-line">
            <div>
              <h2>Your reviewers</h2>
              <p>{branding.instructions}</p>
            </div>

            <div
              className="student-reviewer-filters"
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <label className="student-reviewer-filter" style={{ minWidth: 180 }}>
                Subject
                <select
                  value={subject}
                  onChange={(event) => {
                    setSubject(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All enrolled subjects</option>
                  {subjects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="student-reviewer-filter" style={{ minWidth: 160 }}>
                Sort
                <select
                  value={reviewerSort}
                  onChange={(event) => {
                    setReviewerSort(
                      event.target.value as
                        | 'date-newest'
                        | 'date-oldest'
                        | 'az'
                        | 'za',
                    );
                    setPage(0);
                  }}
                >
                  <option value="date-newest">Newest first</option>
                  <option value="date-oldest">Oldest first</option>
                  <option value="az">A–Z</option>
                  <option value="za">Z–A</option>
                </select>
              </label>
            </div>
          </div>

          {!!sortedReviewers.length && (
            <div
              className="student-reviewer-list"
              style={{
                display: 'block',
                overflow: 'hidden',
                border: '1px solid rgba(74, 48, 83, 0.12)',
                borderRadius: 18,
                background: '#fff',
              }}
            >
              {sortedReviewers.map((reviewer, index) => {
                const linkedIds =
                  reviewerSubjects[reviewer.id] || [reviewer.subject_id];

                const linkedNames = linkedIds
                  .map(subjectName)
                  .filter(Boolean) as string[];

                const linkedLabels = linkedIds
                  .map(subjectLabel)
                  .filter(Boolean);

                const availability = reviewerAvailability(reviewer.id);
                const attemptState = reviewerAttemptState(reviewer);

                return (
                  <article
                    key={reviewer.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '44px minmax(0, 1fr) max-content',
                      alignItems: 'center',
                      columnGap: 12,
                      width: '100%',
                      boxSizing: 'border-box',
                      margin: 0,
                      padding: '14px 16px',
                      border: 0,
                      borderBottom:
                        index < sortedReviewers.length - 1
                          ? '1px solid rgba(74, 48, 83, 0.10)'
                          : 'none',
                      borderRadius: 0,
                      boxShadow: 'none',
                      background: 'transparent',
                    }}
                  >
                    <div
                      className={`subject-icon tone-${index % 3}`}
                      style={{ margin: 0 }}
                    >
                      {linkedNames[0]?.charAt(0) || 'R'}
                    </div>

                    <div style={{ minWidth: 0, margin: 0 }}>
                      <h3
                        style={{
                          margin: 0,
                          lineHeight: 1.25,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {reviewer.title}
                      </h3>

                      <span
                        style={{
                          display: 'block',
                          marginTop: 4,
                          color: 'rgba(74, 48, 83, 0.68)',
                          fontSize: 11,
                          fontWeight: 700,
                          lineHeight: 1.35,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {linkedLabels.join(' • ') || 'Reviewer'}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        justifySelf: 'end',
                        marginLeft: 'auto',
                        paddingLeft: 12,
                      }}
                    >
                      <button
                        disabled={
                          busy ||
                          availability.blocked ||
                          attemptState.exhausted
                        }
                        onClick={() => void startReviewer(reviewer)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 'auto',
                          minWidth: 0,
                          minHeight: 38,
                          padding: '0 13px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {attemptState.inProgressId ? 'Resume' : 'Start'}{' '}
                        {!availability.blocked &&
                          !attemptState.exhausted && <span>→</span>}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!reviewers.length && (
            <div className="empty">
              No published reviewers are available in this subject yet.
            </div>
          )}

          <Pager
            page={page}
            setPage={setPage}
            more={reviewers.length === 15}
          />
        </>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR PROGRESS</span>
              <h1>Attempt history</h1>
              <p>Every attempt is another step forward.</p>
            </div>
          </div>

          <div
            className="panel table-wrap"
            style={{ overflowX: 'auto' }}
          >
            <table
              style={{
                width: '100%',
                tableLayout: 'fixed',
                fontSize: 12,
              }}
            >
              <colgroup>
                <col style={{ width: '28%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ fontSize: 11, padding: '9px 8px' }}>Reviewer</th>
                  <th style={{ fontSize: 11, padding: '9px 8px' }}>Latest Attempt</th>
                  <th style={{ fontSize: 11, padding: '9px 8px' }}>Started</th>
                  <th style={{ fontSize: 11, padding: '9px 8px' }}>Score</th>
                  <th style={{ fontSize: 11, padding: '9px 8px' }}>Details</th>
                </tr>
              </thead>

              <tbody>
                {Array.from(
                  history.reduce((map, item) => {
                    const current = map.get(item.title);
                    if (
                      !current ||
                      item.attempt_number > current.attempt_number ||
                      (item.attempt_number === current.attempt_number &&
                        new Date(item.started_at).getTime() >
                          new Date(current.started_at).getTime())
                    ) {
                      map.set(item.title, item);
                    }
                    return map;
                  }, new Map<string, History>()).values(),
                ).map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontSize: 12, padding: '9px 8px', overflowWrap: 'anywhere' }}>
                      {item.title}
                    </td>
                    <td style={{ fontSize: 12, padding: '9px 8px' }}>
                      Attempt {item.attempt_number}
                    </td>
                    <td style={{ fontSize: 11, padding: '9px 8px', lineHeight: 1.35 }}>
                      {new Date(item.started_at).toLocaleString()}
                    </td>
                    <td style={{ fontSize: 12, padding: '9px 8px' }}>
                      {item.status === 'in_progress' ? (
                        <span>In progress</span>
                      ) : (
                        <span>
                          <strong>
                            {Number(item.score ?? 0)} / {Number(item.max_score ?? 0)}
                          </strong>
                          {!!item.pending && (
                            <small style={{ display: 'block', marginTop: 2 }}>
                              Pending review
                            </small>
                          )}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, padding: '9px 8px' }}>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setAttempt(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setAttempt(item.id);
                          }
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: 0,
                          margin: 0,
                          color: '#352d39',
                          fontSize: 11,
                          fontWeight: 600,
                          lineHeight: 1.2,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span>
                          {item.status === 'in_progress' ? 'Resume' : 'Review'}
                        </span>
                        <span aria-hidden="true" style={{ fontSize: 12 }}>
                          →
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!history.length && (
              <div className="empty">
                Your completed and active attempts will appear here.
              </div>
            )}
          </div>

          <Pager
            page={page}
            setPage={setPage}
            more={history.length === 25}
          />
        </>
      )}
    </>
  );
}

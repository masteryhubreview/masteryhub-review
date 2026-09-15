'use client';

import { useEffect, useState } from 'react';
import type { Profile, Subject, Reviewer } from '@/lib/types';
import { db, rpc } from '@/lib/supabase';
import type { Branding } from './Workspace';
import { Notice, Pager, errorText } from './shared';
import Quiz from './Quiz';

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
}: {
  tab: string;
  profile: Profile;
  branding: Branding;
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
  const [attemptStatuses, setAttemptStatuses] = useState<
    Record<string, ReviewerAttemptStatus>
  >({});
  const [subject, setSubject] = useState('');
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeReviewer, setCodeReviewer] = useState<Reviewer | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [accessCodeError, setAccessCodeError] = useState('');
  const [retryReviewer, setRetryReviewer] = useState<Reviewer | null>(null);

  useEffect(() => {
    setPage(0);
    setAttempt(null);
  }, [tab]);

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
          .select('*')
          .order('created_at', { ascending: false })
          .range(page * 3, page * 3 + 2);

        if (allowedReviewerIds) {
          reviewerQuery = reviewerQuery.in('id', allowedReviewerIds);
        }

        const { data: reviewerRows, error: reviewerError } =
          await reviewerQuery;

        if (reviewerError) throw reviewerError;

        const currentReviewers = (reviewerRows || []) as Reviewer[];
        const ids = currentReviewers.map((item) => item.id);

        const [ruleRows, notificationRows, attemptStatusRows] =
          await Promise.all([
            rpc<ReviewerRuleSummary[]>('my_reviewer_rules'),
            rpc<StudentNotification[]>('my_notifications'),
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
  }, [tab, subject, page, attempt]);

  if (attempt) {
    return <Quiz id={attempt} onClose={() => setAttempt(null)} />;
  }

  const subjectName = (id: string) =>
    subjects.find((item) => item.id === id)?.name;

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

      {tab === 'Dashboard' ? (
        <>
          <section className="hero">
            <div>
              <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
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
                  >
                    <div>
                      <strong>{notification.title}</strong>
                      <p>{notification.message}</p>
                    </div>
                    <time>
                      {new Date(
                        notification.created_at,
                      ).toLocaleString()}
                    </time>
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

            <label>
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
          </div>

          <div className="card-grid">
            {reviewers.map((reviewer, index) => {
              const linkedIds =
                reviewerSubjects[reviewer.id] || [reviewer.subject_id];

              const linkedNames = linkedIds
                .map(subjectName)
                .filter(Boolean) as string[];
              const rules = reviewerRules[reviewer.id];
              const availability = reviewerAvailability(reviewer.id);
              const attemptState = reviewerAttemptState(reviewer);

              return (
                <article className="review-card" key={reviewer.id}>
                  <div className={`subject-icon tone-${index % 3}`}>
                    {linkedNames[0]?.charAt(0) || 'R'}
                  </div>

                  <span className="eyebrow">
                    {linkedNames.join(' • ') || 'Reviewer'}
                  </span>

                  <h3>{reviewer.title}</h3>
                  <p>
                    {reviewer.description ||
                      'Build confidence with focused practice.'}
                  </p>

                  <div
                    className="meta"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: 6,
                      alignItems: 'stretch',
                      marginTop: 8,
                      marginBottom: 10,
                    }}
                  >
                    {rules?.time_limit_minutes ? (
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          minHeight: 30,
                        }}
                      >
                        Time limit: {rules.time_limit_minutes} min
                      </span>
                    ) : null}

                    {rules?.due_at ? (
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          minHeight: 30,
                        }}
                      >
                        Due:{' '}
                        {new Date(rules.due_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}{' '}
                        {new Date(rules.due_at).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    ) : null}

                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        minHeight: 30,
                      }}
                    >
                      Allowed attempts:{' '}
                      {reviewer.settings.max_attempts === null
                        ? 'Unlimited'
                        : reviewer.settings.max_attempts}
                    </span>

                    {rules?.access_code_enabled ? (
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          minHeight: 30,
                        }}
                      >
                        Access code needed
                      </span>
                    ) : null}
                  </div>

                  <button
                    disabled={
                      busy ||
                      availability.blocked ||
                      attemptState.exhausted
                    }
                    onClick={() => void startReviewer(reviewer)}
                  >
                    {attemptState.exhausted
                      ? 'Attempt limit reached'
                      : availability.blocked
                        ? availability.label
                        : attemptState.label}{' '}
                    {!availability.blocked &&
                      !attemptState.exhausted && <span>→</span>}
                  </button>
                </article>
              );
            })}
          </div>

          {!reviewers.length && (
            <div className="empty">
              No published reviewers are available in this subject yet.
            </div>
          )}

          <Pager
            page={page}
            setPage={setPage}
            more={reviewers.length === 3}
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

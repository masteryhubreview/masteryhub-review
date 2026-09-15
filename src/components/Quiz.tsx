'use client';

import { useEffect, useRef, useState } from 'react';
import { rpc } from '@/lib/supabase';
import type { AttemptView, PublicQuestion } from '@/lib/types';
import { ImageAttachment, Notice, errorText } from './shared';

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

function isDeviceReplacementError(error: unknown) {
  return errorText(error).includes('DEVICE_SESSION_REPLACED');
}


function questionTypeLabel(type: PublicQuestion['type']) {
  switch (type) {
    case 'mc_single':
      return 'Multiple choice';
    case 'mc_multi':
      return 'Multiple answers';
    case 'fill_blank':
      return 'Fill in the blank';
    case 'multi_blank':
      return 'Multiple blanks';
    case 'short_answer':
      return 'Short answer';
    case 'long_answer':
      return 'Long answer';
    default:
      return String(type).replaceAll('_', ' ');
  }
}

function questionInstruction(type: PublicQuestion['type']) {
  switch (type) {
    case 'mc_single':
      return 'Choose the best answer.';
    case 'mc_multi':
      return 'Select all that apply.';
    case 'fill_blank':
      return 'Enter your answer in the text box.';
    case 'multi_blank':
      return 'Answer each text box.';
    case 'short_answer':
      return 'Type your answer.';
    case 'long_answer':
      return 'Write your answer.';
    default:
      return 'Answer the question below.';
  }
}

function pointLabel(points: number) {
  return `${points} ${points === 1 ? 'point' : 'points'}`;
}


function formatRemaining(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function questionExplanation(question: PublicQuestion | undefined) {
  return (
    question as
      | (PublicQuestion & { explanation?: string | null })
      | undefined
  )?.explanation?.trim();
}


function studentWatermark(current: AttemptView | null) {
  if (!current) return '';

  const data = current as AttemptView & {
    student_id?: string | null;
    student_number?: string | null;
    student_name?: string | null;
    profiles?: {
      display_name?: string | null;
      student_number?: string | null;
      email?: string | null;
    } | null;
    profile?: {
      display_name?: string | null;
      student_number?: string | null;
      email?: string | null;
    } | null;
  };

  const profile = data.profiles || data.profile;
  const name = profile?.display_name || data.student_name || '';
  const number = profile?.student_number || data.student_number || '';
  const email = profile?.email || '';

  const identity = [name, number].filter(Boolean).join(' • ');
  if (identity) return identity;
  if (email) return email;
  if (data.student_id) return `Student • ${data.student_id.slice(0, 8)}`;
  return 'Authenticated student';
}

export default function Quiz({
  id,
  onClose,
  admin = false,
}: {
  id: string;
  onClose: () => void;
  admin?: boolean;
}) {
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  const lock = useRef(false);
  const autoSubmitLock = useRef(false);
  const initialPositionLoaded = useRef(false);

  async function refresh() {
    try {
      const data = admin
        ? await rpc<AttemptView>('get_attempt', { attempt: id })
        : await rpc<AttemptView & { current_question_index?: number }>(
            'device_get_attempt',
            {
              attempt: id,
              device_token: studentDeviceToken(),
            },
          );

      setAttempt(data);

      if (
        !admin &&
        !initialPositionLoaded.current &&
        typeof (
          data as AttemptView & { current_question_index?: number }
        ).current_question_index === 'number'
      ) {
        const savedIndex = (
          data as AttemptView & { current_question_index?: number }
        ).current_question_index as number;

        setIndex(
          Math.max(
            0,
            Math.min(savedIndex, Math.max(0, data.questions.length - 1)),
          ),
        );
        initialPositionLoaded.current = true;
      }

      return data;
    } catch (error) {
      if (!admin && isDeviceReplacementError(error)) {
        setDeviceBlocked(true);
        setMessage(
          'This quiz was continued on another device. This device can no longer change or submit the attempt.',
        );
      }

      throw error;
    }
  }

  async function saveResponse(
    questionId: string,
    value: string[],
  ) {
    if (admin) {
      throw new Error('Student response editing is unavailable in admin view.');
    }

    try {
      await rpc('device_save_response', {
        attempt: id,
        question: questionId,
        answer: value,
        device_token: studentDeviceToken(),
      });
    } catch (error) {
      if (isDeviceReplacementError(error)) {
        setDeviceBlocked(true);
        setMessage(
          'This quiz was continued on another device. Your changes were not saved on this device.',
        );
      }

      throw error;
    }
  }

  async function submitAttempt() {
    if (admin) return;

    try {
      await rpc('device_submit_attempt', {
        attempt: id,
        device_token: studentDeviceToken(),
      });
    } catch (error) {
      if (isDeviceReplacementError(error)) {
        setDeviceBlocked(true);
        setMessage(
          'This quiz was continued on another device. This device cannot submit the attempt.',
        );
      }

      throw error;
    }
  }

  async function savePosition(nextIndex: number) {
    if (admin || deviceBlocked) return;

    try {
      await rpc('device_set_attempt_position', {
        attempt: id,
        question_index: nextIndex,
        device_token: studentDeviceToken(),
      });
    } catch (error) {
      if (isDeviceReplacementError(error)) {
        setDeviceBlocked(true);
        setMessage(
          'This quiz was continued on another device. Continue the quiz on the active device.',
        );
        throw error;
      }
    }
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(errorText(error)));
  }, [id]);

  function attemptDeadline(current: AttemptView | null) {
    if (!current || current.status !== 'in_progress') return null;

    const settings = current.settings as AttemptView['settings'] & {
      time_limit_minutes?: number | null;
      available_until?: string | null;
    };

    const deadlines: number[] = [];

    if (settings.time_limit_minutes) {
      deadlines.push(
        new Date(current.started_at).getTime() +
          settings.time_limit_minutes * 60_000,
      );
    }

    if (settings.available_until) {
      deadlines.push(new Date(settings.available_until).getTime());
    }

    return deadlines.length ? Math.min(...deadlines) : null;
  }

  useEffect(() => {
    const deadline = attemptDeadline(attempt);

    if (!deadline || admin || attempt?.status !== 'in_progress') {
      setRemainingSeconds(null);
      return;
    }

    const update = async () => {
      const seconds = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 1000),
      );

      setRemainingSeconds(seconds);

      if (
        seconds === 0 &&
        !autoSubmitLock.current &&
        attempt?.status === 'in_progress'
      ) {
        autoSubmitLock.current = true;
        setBusy(true);
        setMessage('Time is up. Submitting your reviewer…');

        try {
          await submitAttempt();
          await refresh();
          setMessage('Time is up. Your reviewer was submitted.');
        } catch (error) {
          setMessage(errorText(error));
        } finally {
          setBusy(false);
        }
      }
    };

    void update();
    const timer = window.setInterval(() => {
      void update();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [attempt?.started_at, attempt?.status, id, admin]);

  const q = attempt?.questions[index];
  const active =
    attempt?.status === 'in_progress' &&
    !admin &&
    !deviceBlocked &&
    (remainingSeconds === null || remainingSeconds > 0);
  const locked = !active || !!(attempt?.settings.instant && q?.response);
  const instant = attempt?.settings.instant;
  const explanation = questionExplanation(q);

  useEffect(() => {
    setAnswer(q?.response || []);
    setDirty(false);
    setSaved('');
  }, [q?.id, q?.response]);

  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty]);

  // Non-feedback mode autosaves drafts after typing settles.
  // Feedback mode uses explicit confirmation.
  useEffect(() => {
    if (!dirty || !q || !active || instant || deviceBlocked) return;

    const timer = setTimeout(async () => {
      if (lock.current) return;

      lock.current = true;
      setBusy(true);

      try {
        await saveResponse(q.id, answer);
        setDirty(false);
        setSaved('Saved');
      } catch (error) {
        setMessage(errorText(error));
      } finally {
        lock.current = false;
        setBusy(false);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [answer, dirty, q?.id, active, instant, id]);

  async function save() {
    if (!q || !active || locked) return;

    await saveResponse(q.id, answer);

    setDirty(false);
    setSaved('Saved');
  }

  async function navigate(next: number) {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setMessage('');

    try {
      if (dirty) {
        if (instant) {
          if (!confirm('Leave this unconfirmed answer? It will not be saved.')) return;
        } else {
          await save();
        }
      }

      const current = await refresh();
      const nextIndex = Math.max(
        0,
        Math.min(next, current.questions.length - 1),
      );

      await savePosition(nextIndex);
      setIndex(nextIndex);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  function edit(next: string[]) {
    setAnswer(next);
    setDirty(true);
    setSaved('Unsaved changes');
  }

  async function closeQuiz() {
    if (dirty) {
      if (instant) {
        if (!confirm('Leave the unconfirmed answer?')) return;
      } else {
        try {
          await save();
        } catch (error) {
          setMessage(errorText(error));
          return;
        }
      }
    }

    onClose();
  }

  async function confirmInstantAnswer() {
    if (!q || lock.current) return;

    lock.current = true;
    setBusy(true);
    setMessage('');

    try {
      await save();
      await refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function chooseSingleAnswer(choiceId: string) {
    if (!q || !active || locked || lock.current) return;

    const next = [choiceId];
    setAnswer(next);
    setMessage('');

    if (!instant) {
      setDirty(true);
      setSaved('Unsaved changes');
      return;
    }

    lock.current = true;
    setBusy(true);
    setDirty(false);
    setSaved('Saving...');

    try {
      await saveResponse(q.id, next);
      setSaved('Saved');
      await refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function finishAttempt() {
    if (!attempt || lock.current) return;

    if (!confirm('Finish and submit this quiz? Submitted answers cannot be changed.')) return;

    lock.current = true;
    setBusy(true);
    setMessage('');

    try {
      if (dirty) await save();
      await submitAttempt();
      await refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (deviceBlocked && attempt) {
    return (
      <div className="quiz-shell">
        <div className="notice">
          <strong>Quiz continued on another device</strong>
          <p>
            This device is now blocked from changing or submitting this
            attempt. Your saved answers and original timer remain with the
            same attempt on the active device.
          </p>
        </div>

        <button className="ghost" type="button" onClick={onClose}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (!attempt) {
    return (
      <>
        <Notice message={message} />
        <p>Loading attempt...</p>
        <button className="ghost" onClick={onClose}>
          Back
        </button>
      </>
    );
  }

  const totalQuestions = attempt.questions.length;
  const progressPercent = totalQuestions
    ? Math.round(((index + 1) / totalQuestions) * 100)
    : 0;

  const revealed =
    !!q &&
    !!q.correct &&
    (!active || (instant && locked));

  const watermarkIdentity = !admin ? studentWatermark(attempt) : '';

  return (
    <div className="quiz-layout quiz-reference-layout">
      <button className="text-button quiz-workspace-back" onClick={closeQuiz}>
        ← Back to workspace
      </button>

      <div
        className="page-heading quiz-page-heading"
        style={{
          display: 'block',
          marginBottom: 14,
        }}
      >
        <h1 style={{ marginBottom: 6 }}>{attempt.title}</h1>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'nowrap',
            gap: '0 8px',
            fontSize: 12,
            opacity: 0.78,
            whiteSpace: 'nowrap',
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          <span>
            <b>Started:</b>{' '}
            {new Date(attempt.started_at).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>

          {!!(
            attempt.settings as AttemptView['settings'] & {
              time_limit_minutes?: number | null;
            }
          ).time_limit_minutes && (
            <>
              <span aria-hidden="true">•</span>
              <span>
                <b>Time:</b>{' '}
                {remainingSeconds !== null
                  ? formatRemaining(remainingSeconds)
                  : `${(
                      attempt.settings as AttemptView['settings'] & {
                        time_limit_minutes?: number | null;
                      }
                    ).time_limit_minutes} min`}
              </span>
            </>
          )}

          <span aria-hidden="true">•</span>

          <span>
            <b>Status:</b> {attempt.status.replaceAll('_', ' ')}
          </span>
        </div>
      </div>

      <Notice message={message} />

      {attempt.status !== 'in_progress' && (
        <section className="result-banner quiz-result-banner">
          <div>
            <span className="eyebrow">
              {attempt.pending ? 'PROVISIONAL RESULT' : 'YOUR RESULT'}
            </span>
            <h2>
              {attempt.pending
                ? 'Awaiting manual review'
                : `${attempt.score} / ${attempt.max_score}`}
            </h2>
            <p>
              {attempt.pending
                ? `${attempt.score} points awarded so far. ${attempt.pending} response(s) still need review.`
                : 'Completed and saved to attempt history.'}
            </p>
          </div>
        </section>
      )}

      {!q ? (
        <div className="empty">Answer review is not enabled for this attempt.</div>
      ) : (
        <>
          <section
            className="question-panel quiz-reference-card"
            style={{
              overflow: 'hidden',
              padding: 0,
              borderRadius: 22,
              position: 'relative',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '12px 18px',
                borderBottom: '1px solid rgba(74, 48, 83, 0.10)',
                background: 'rgba(255,255,255,0.72)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <img
                  src="/masteryhub-review-logo.png"
                  alt="MasteryHub Review"
                  draggable={false}
                  style={{
                    width: 34,
                    height: 34,
                    objectFit: 'contain',
                    flex: '0 0 auto',
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <strong
                    style={{
                      display: 'block',
                      fontSize: 12,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    MasteryHub Review
                  </strong>
                  <small style={{ opacity: 0.68 }}>Review • Practice • Progress</small>
                </div>
              </div>

              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  opacity: 0.55,
                  whiteSpace: 'nowrap',
                }}
              >
                {admin ? 'ADMIN REVIEW' : 'STUDENT QUIZ'}
              </span>
            </div>

            {!admin && watermarkIdentity && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 0,
                  overflow: 'hidden',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: '-18% -20%',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))',
                    alignContent: 'space-around',
                    gap: '46px 26px',
                    transform: 'rotate(-18deg)',
                    opacity: 0.075,
                  }}
                >
                  {Array.from({ length: 12 }, (_, watermarkIndex) => (
                    <span
                      key={watermarkIndex}
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        color: '#352d39',
                        whiteSpace: 'nowrap',
                        textAlign: 'center',
                      }}
                    >
                      {watermarkIdentity}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div
              style={{
                padding: '18px 22px 22px',
                position: 'relative',
                zIndex: 1,
              }}
            >
            <div className="quiz-question-topline">
              <div>
                <span className="quiz-question-count">
                  Question {index + 1} of {totalQuestions}
                </span>
                <span className="quiz-question-type">{questionTypeLabel(q.type)}</span>
              </div>

              <span className="quiz-question-points">{saved || pointLabel(q.points)}</span>
            </div>

            <div
              className="quiz-thin-progress"
              role="progressbar"
              aria-label="Quiz progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <span style={{ width: `${progressPercent}%` }} />
            </div>

            <div style={{ marginTop: 18, marginBottom: 16 }}>
              <h2
                className="question-text quiz-reference-question"
                style={{ marginBottom: 6, lineHeight: 1.35 }}
              >
                {q.text}
              </h2>
              <p
                className="quiz-question-instruction"
                style={{ margin: 0, opacity: 0.72 }}
              >
                {questionInstruction(q.type)}
              </p>
            </div>

            <ImageAttachment path={q.image_path} />

            <fieldset className="quiz-answer-fieldset" disabled={locked || busy}>
              <legend className="sr-only">Your answer</legend>

              {q.type.startsWith('mc_') ? (
                <div className="choices quiz-reference-choices">
                  {q.choices.map((choice, choiceIndex) => {
                    const selected = answer.includes(choice.id);
                    const correctChoice = !!q.correct?.includes(choice.id);
                    const wrongSelected = revealed && selected && !correctChoice;

                    const classNames = [
                      'choice',
                      'quiz-reference-choice',
                      selected ? 'selected' : '',
                      revealed && correctChoice ? 'is-correct' : '',
                      wrongSelected ? 'is-incorrect' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <label key={choice.id} className={classNames}>
                        <input
                          type={q.type === 'mc_multi' ? 'checkbox' : 'radio'}
                          name={q.type === 'mc_multi' ? `choice-${choice.id}` : 'choice'}
                          checked={selected}
                          onChange={(event) => {
                            if (q.type === 'mc_single') {
                              void chooseSingleAnswer(choice.id);
                              return;
                            }

                            edit(
                              event.target.checked
                                ? [...answer, choice.id]
                                : answer.filter(
                                    (item) => item !== choice.id,
                                  ),
                            );
                          }}
                        />

                        <span className="choice-letter">
                          {String.fromCharCode(65 + choiceIndex)}
                        </span>

                        <span
                          className="quiz-choice-content"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            gap: 12,
                            minWidth: 0,
                          }}
                        >
                          <span
                            className="quiz-choice-text"
                            style={{ flex: '1 1 auto', minWidth: 0 }}
                          >
                            {choice.text}
                          </span>

                          {revealed && correctChoice && (
                            <span
                              aria-label="Correct answer"
                              title="Correct answer"
                              style={{
                                marginLeft: 'auto',
                                alignSelf: 'center',
                                flex: '0 0 auto',
                                color: '#18864b',
                                fontSize: 22,
                                fontWeight: 800,
                                lineHeight: 1,
                                background: 'none',
                                border: 0,
                                padding: 0,
                              }}
                            >
                              ✓
                            </span>
                          )}

                          {wrongSelected && (
                            <span
                              aria-label="Incorrect answer"
                              title="Your answer is incorrect"
                              style={{
                                marginLeft: 'auto',
                                alignSelf: 'center',
                                flex: '0 0 auto',
                                color: '#d53b45',
                                fontSize: 22,
                                fontWeight: 800,
                                lineHeight: 1,
                                background: 'none',
                                border: 0,
                                padding: 0,
                              }}
                            >
                              ×
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : q.type === 'long_answer' ? (
                <label className="quiz-text-response">
                  Your response
                  <textarea
                    rows={7}
                    maxLength={20000}
                    value={answer[0] || ''}
                    onChange={(event) => edit([event.target.value])}
                  />
                </label>
              ) : (
                <div className="quiz-blank-responses">
                  {Array.from({ length: q.blanks }, (_, blankIndex) => (
                    <label key={blankIndex}>
                      {q.blanks > 1 ? `Answer ${blankIndex + 1}` : 'Your answer'}
                      <input
                        maxLength={5000}
                        value={answer[blankIndex] || ''}
                        onChange={(event) => {
                          const next = Array.from(
                            { length: q.blanks },
                            (_, answerIndex) => answer[answerIndex] || '',
                          );
                          next[blankIndex] = event.target.value;
                          edit(next);
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            {active &&
              instant &&
              !locked &&
              q.type !== 'mc_single' && (
              <div className="quiz-confirm-row">
                <button
                  className="quiz-confirm-answer"
                  disabled={busy || !answer.some((item) => item.trim())}
                  onClick={confirmInstantAnswer}
                >
                  Confirm answer
                </button>
                <span>Your answer is checked after confirmation.</span>
              </div>
            )}

            {q.awarded !== null && q.awarded !== undefined && (
              <div
                className={[
                  'feedback',
                  'quiz-inline-feedback',
                  q.awarded === q.points
                    ? 'correct'
                    : q.awarded > 0
                      ? 'partial'
                      : 'incorrect',
                ].join(' ')}
              >
                <div>
                  <strong>
                    {q.awarded === q.points
                      ? 'Correct'
                      : q.awarded > 0
                        ? 'Partial credit'
                        : 'Incorrect'}
                  </strong>
                  <span>
                    {q.awarded} / {pointLabel(q.points)}
                  </span>
                </div>

                {q.notes && <p>{q.notes}</p>}
              </div>
            )}

            {q.awarded !== null &&
              q.awarded !== undefined &&
              explanation && (
                <div className="quiz-answer-explanation">
                  <b>Explanation</b>
                  <p>{explanation}</p>
                </div>
              )}

            {q.pending && (
              <div className="notice">
                This response requires manual review; it has not been marked incorrect.
              </div>
            )}

            {q.correct && !q.type.startsWith('mc_') && (
              <div className="answer-key quiz-answer-key">
                <b>Accepted answer</b>
                <p>
                  {q.accepted?.map((accepted) => accepted.join(' / ')).join('; ') ||
                    'Manually reviewed response'}
                </p>
              </div>
            )}

            {q.notes && (q.awarded === null || q.awarded === undefined) && (
              <p className="quiz-admin-feedback">Administrator feedback: {q.notes}</p>
            )}

            {admin &&
              attempt.status !== 'in_progress' &&
              (q.type === 'long_answer' ||
                (q.type === 'short_answer' && q.accepted?.length === 0)) && (
                <GradeForm key={q.id} q={q} id={id} onSave={refresh} />
              )}

            <div
              aria-hidden="true"
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 7,
                marginTop: 18,
                paddingTop: 12,
                borderTop: '1px solid rgba(74, 48, 83, 0.08)',
                opacity: 0.34,
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            >
              <img
                src="/masteryhub-review-logo.png"
                alt=""
                draggable={false}
                style={{ width: 20, height: 20, objectFit: 'contain' }}
              />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>
                MASTERYHUB REVIEW
              </span>
              {!admin && watermarkIdentity && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    marginLeft: 5,
                    maxWidth: '55%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={watermarkIdentity}
                >
                  • {watermarkIdentity}
                </span>
              )}
            </div>
            </div>
          </section>

          <div className="quiz-actions quiz-reference-actions">
            <button
              disabled={busy || index === 0}
              className="ghost"
              onClick={() => navigate(index - 1)}
            >
              Back
            </button>

            {index < totalQuestions - 1 ? (
              <button disabled={busy} onClick={() => navigate(index + 1)}>
                Next →
              </button>
            ) : active ? (
              <button disabled={busy} onClick={finishAttempt}>
                Finish Quiz
              </button>
            ) : (
              <button className="ghost" onClick={onClose}>
                Finish review
              </button>
            )}
          </div>

          <p className="caption quiz-save-caption">
            {active
              ? instant
                ? q.type === 'mc_single'
                  ? 'Your answer is checked as soon as you choose an option.'
                  : 'Confirm the answer to check it. Confirmed answers cannot be changed.'
                : 'Answers save automatically. Check for the Saved indicator before leaving.'
              : 'Historical question content is preserved for this attempt.'}
          </p>
        </>
      )}
    </div>
  );
}

function GradeForm({
  q,
  id,
  onSave,
}: {
  q: PublicQuestion;
  id: string;
  onSave: () => Promise<unknown>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grade-form stack"
      onSubmit={async (event) => {
        event.preventDefault();

        const form = new FormData(event.currentTarget);
        setBusy(true);

        try {
          await rpc('grade_response', {
            attempt: id,
            question: q.id,
            points: Number(form.get('points')),
            notes: String(form.get('notes')),
          });
          await onSave();
          setMessage('Grade saved.');
        } catch (error) {
          setMessage(errorText(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Manual scoring</h3>

      <label>
        Points awarded
        <input
          type="number"
          name="points"
          min="0"
          max={q.points}
          step="0.0001"
          defaultValue={q.awarded ?? 0}
          required
        />
      </label>

      <label>
        Feedback
        <textarea name="notes" defaultValue={q.notes || ''} />
      </label>

      <button disabled={busy}>Save grade</button>
      <Notice message={message} />
    </form>
  );
}

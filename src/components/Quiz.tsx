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

function hasCompleteAnswer(
  question: PublicQuestion | undefined,
  value: string[],
) {
  if (!question) return false;

  if (question.type === 'mc_single' || question.type === 'mc_multi') {
    return value.length > 0;
  }

  if (question.type === 'multi_blank') {
    return (
      value.length >= question.blanks &&
      Array.from({ length: question.blanks }, (_, index) => value[index] || '').every(
        (item) => item.trim().length > 0,
      )
    );
  }

  return (value[0] || '').trim().length > 0;
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
  const studentNumber = profile?.student_number || data.student_number || '';

  if (studentNumber) return `STUDENT ID • ${studentNumber}`;
  if (data.student_id) return `STUDENT ID • ${data.student_id.slice(0, 8).toUpperCase()}`;

  return 'STUDENT ID • AUTHENTICATED';
}

export default function Quiz({
  id,
  onClose,
  admin = false,
  logoPath,
}: {
  id: string;
  onClose: () => void;
  admin?: boolean;
  logoPath?: string | null;
}) {
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [gradingComplete, setGradingComplete] = useState(false);
  const [listReview, setListReview] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const lock = useRef(false);
  const autoSubmitLock = useRef(false);
  const initialPositionLoaded = useRef(false);
  const openReviewCard = useRef<HTMLDetailsElement | null>(null);

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

      if (!admin && data.status !== 'in_progress' && !initialPositionLoaded.current) {
        setIndex(0);
        initialPositionLoaded.current = true;
      } else if (
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

    await rpc('device_save_response', {
      attempt: id,
      question: questionId,
      answer: value,
      device_token: studentDeviceToken(),
    });
  }

  async function submitAttempt() {
    if (admin) return;

    await rpc('device_submit_attempt', {
      attempt: id,
      device_token: studentDeviceToken(),
    });
  }

  async function savePosition(nextIndex: number) {
    if (admin) return;

    await rpc('device_set_attempt_position', {
      attempt: id,
      question_index: nextIndex,
      device_token: studentDeviceToken(),
    });
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


  useEffect(() => {
    if (admin) return;

    const style = document.createElement('style');
    style.setAttribute('data-quiz-print-protection', 'true');
    style.textContent = `
      @media print {
        body * {
          visibility: hidden !important;
        }

        .quiz-print-protected,
        .quiz-print-protected * {
          visibility: visible !important;
        }

        .quiz-print-protected {
          display: flex !important;
          position: fixed !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          padding: 32px !important;
          box-sizing: border-box !important;
          background: #ffffff !important;
          color: #352d39 !important;
          align-items: center !important;
          justify-content: center !important;
          text-align: center !important;
          z-index: 2147483647 !important;
        }

        .quiz-layout,
        .question-panel,
        .quiz-reference-card,
        .quiz-answer-fieldset,
        .choices,
        .quiz-reference-choices,
        .quiz-answer-key,
        .quiz-answer-explanation,
        .quiz-inline-feedback,
        .result-banner {
          display: none !important;
        }
      }
    `;

    document.head.appendChild(style);
    return () => style.remove();
  }, [admin]);

  const q = attempt?.questions[index];
  const active =
    attempt?.status === 'in_progress' &&
    !admin &&
    (remainingSeconds === null || remainingSeconds > 0);
  const locked = !active || !!(attempt?.settings.instant && q?.response);
  const instant = attempt?.settings.instant;
  const explanation = questionExplanation(q);
  const currentQuestionAnswered = hasCompleteAnswer(q, answer);

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
    if (!dirty || !q || !active || instant) return;

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

    if (active && next > index && !hasCompleteAnswer(q, answer)) {
      setMessage('Please answer the current question before continuing.');
      return;
    }

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

      if (current.status === 'in_progress') {
        await savePosition(nextIndex);
      }
      setGradingComplete(false);
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

  async function saveGradeAndGoNext(currentQuestionId: string) {
    const current = await refresh();

    const pendingManualIndexes = current.questions
      .map((question, questionIndex) => ({ question, questionIndex }))
      .filter(({ question }) => {
        const manualType =
          question.type === 'long_answer' ||
          (question.type === 'short_answer' && question.accepted?.length === 0);

        return manualType && !!question.pending && question.id !== currentQuestionId;
      })
      .map(({ questionIndex }) => questionIndex);

    if (!pendingManualIndexes.length) {
      setGradingComplete(true);
      setMessage('Manual grading complete. No responses are waiting for review.');
      return;
    }

    const nextAfterCurrent = pendingManualIndexes.find(
      (questionIndex) => questionIndex > index,
    );

    setGradingComplete(false);
    setMessage('');
    setIndex(nextAfterCurrent ?? pendingManualIndexes[0]);
  }

  function responseText(question: PublicQuestion) {
    const response = question.response || [];

    if (!response.length || !response.some((item) => item.trim())) {
      return 'Not answered';
    }

    if (question.type === 'mc_single' || question.type === 'mc_multi') {
      const labels = response
        .map((choiceId) => question.choices.find((choice) => choice.id === choiceId)?.text)
        .filter((value): value is string => !!value);

      return labels.length ? labels.join(', ') : 'Not answered';
    }

    return response.filter((item) => item.trim()).join(' • ');
  }

  function answerStatus(question: PublicQuestion) {
    if (!hasCompleteAnswer(question, question.response || [])) return 'Unanswered';
    if (question.pending) return 'Pending review';

    if (
      question.awarded !== null &&
      question.awarded !== undefined
    ) {
      if (question.awarded === question.points) return 'Correct';
      if (question.awarded > 0) return 'Partial credit';
      return 'Incorrect';
    }

    return 'Answered';
  }

  async function openListReview() {
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

      await refresh();
      setListReview(true);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  async function openQuestionFromList(questionIndex: number) {
    if (attempt?.status === 'in_progress') {
      try {
        await savePosition(questionIndex);
      } catch (error) {
        setMessage(errorText(error));
        return;
      }
    }

    setIndex(questionIndex);
    setListReview(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function finishAttempt() {
    if (!attempt || lock.current) return;

    if (active && !hasCompleteAnswer(q, answer)) {
      setMessage('Please answer the current question before finishing the quiz.');
      return;
    }

    if (!confirm('Finish and submit this quiz? Submitted answers cannot be changed.')) return;

    lock.current = true;
    setBusy(true);
    setMessage('');

    try {
      if (dirty) await save();
      await submitAttempt();
      await refresh();
      setIndex(0);
      setListReview(false);
      setReviewMode(false);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
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
    <>
      <style>{`
        /* Keep the existing logo row height, but let the uploaded logo itself fill it. */
        .quiz-brand-header {
          height: 124px !important;
          min-height: 124px !important;
          padding: 0 18px !important;
          border: 0 !important;
          background: transparent !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          overflow: hidden !important;
          position: relative !important;
        }

        .quiz-brand-logo {
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          min-height: 0 !important;
          max-width: none !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          margin: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          background: transparent !important;
          overflow: hidden !important;
        }

        .quiz-brand-logo *,
        .quiz-brand-logo > *,
        .quiz-brand-logo div,
        .quiz-brand-logo span,
        .quiz-brand-logo picture {
          margin: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          background: transparent !important;
        }

        .quiz-brand-logo img,
        .quiz-brand-logo img.brand-logo,
        .quiz-brand-logo picture img {
          display: block !important;
          position: static !important;
          width: 360px !important;
          height: 100px !important;
          min-width: 360px !important;
          min-height: 100px !important;
          max-width: none !important;
          max-height: none !important;
          object-fit: contain !important;
          object-position: center center !important;
          margin: 0 auto !important;
          padding: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          background: transparent !important;
          transform: translateY(4px) scale(1.75) !important;
          transform-origin: center center !important;
        }

        .quiz-brand-logo > p {
          margin: 0 !important;
          text-align: center !important;
        }

        /* Override the existing global button rules that were keeping these small. */
        .quiz-reference-actions {
          gap: 16px !important;
          margin-top: 16px !important;
        }

        .quiz-reference-actions > button {
          min-width: 120px !important;
          width: auto !important;
          height: 45px !important;
          min-height: 45px !important;
          padding: 0 24px !important;
          border-radius: 15px !important;
          font-size: 16px !important;
          font-weight: 800 !important;
          line-height: 1 !important;
        }

        .quiz-reference-actions > button:last-child {
          min-width: 130px !important;
        }

        .quiz-list-review {
          display: grid;
          gap: 14px;
        }

        .quiz-list-review-card {
          width: 100%;
          text-align: left;
          padding: 18px 20px;
          border-radius: 18px;
          border: 1px solid rgba(74, 48, 83, 0.12);
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 8px 24px rgba(74, 48, 83, 0.05);
        }

        .quiz-list-review-card:hover {
          border-color: rgba(74, 48, 83, 0.28);
        }

        details.quiz-list-review-card {
          padding: 0;
          overflow: hidden;
        }

        .quiz-list-review-summary {
          list-style: none;
          cursor: pointer;
          padding: 15px 17px;
        }

        .quiz-list-review-summary::-webkit-details-marker {
          display: none;
        }

        .quiz-list-review-summary::marker {
          display: none;
          content: '';
        }

        .quiz-list-review-details {
          padding: 0 17px 17px;
          border-top: 1px solid rgba(74, 48, 83, 0.08);
        }

        .quiz-list-review-number {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 9px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          opacity: 0.72;
        }

        .quiz-list-review-question {
          margin: 0 0 12px;
          font-size: 17px;
          line-height: 1.45;
          font-weight: 800;
        }

        .quiz-list-review-answer {
          margin: 0;
          font-size: 15px;
          line-height: 1.5;
        }

        .quiz-list-review-answer b {
          display: block;
          margin-bottom: 3px;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          opacity: 0.65;
        }

        .quiz-list-review-status {
          flex: 0 0 auto;
          padding: 5px 9px;
          border-radius: 999px;
          background: rgba(74, 48, 83, 0.07);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0;
          text-transform: none;
          opacity: 1;
        }

        @media (max-width: 600px) {
          .quiz-brand-logo img,
          .quiz-brand-logo img.brand-logo,
          .quiz-brand-logo picture img {
            width: 250px !important;
            min-width: 250px !important;
            transform: translateY(9px) scale(1.25) !important;
          }

          .quiz-reference-actions > button {
            min-width: 112px !important;
            height: 45px !important;
            min-height: 45px !important;
            padding: 0 22px !important;
            font-size: 16px !important;
          }
        }
      `}</style>
      {!admin && (
        <div
          className="quiz-print-protected"
          style={{ display: 'none' }}
          aria-hidden="true"
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: '0.12em',
                marginBottom: 12,
              }}
            >
              MASTERYHUB REVIEW
            </div>
            <h1 style={{ margin: '0 0 10px' }}>Protected Quiz Content</h1>
            <p style={{ margin: '0 0 14px', lineHeight: 1.6 }}>
              Questions, choices, answers, explanations, images, and results
              are masked and unavailable in print or PDF output.
            </p>
            <strong>{watermarkIdentity}</strong>
          </div>
        </div>
      )}

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

      <section
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '10px 18px',
          marginBottom: 14,
          padding: '12px 16px',
          borderRadius: 16,
          background: 'rgba(255,255,255,0.75)',
          border: '1px solid rgba(74,48,83,0.10)',
          fontSize: 13,
        }}
      >
        <span><b>Question:</b> {index + 1}/{totalQuestions}</span>
        <span><b>Progress:</b> {progressPercent}%</span>
        {!!(attempt.settings as AttemptView['settings'] & { time_limit_minutes?: number | null }).time_limit_minutes && (
          <span><b>Time:</b> {remainingSeconds !== null ? formatRemaining(remainingSeconds) : `${(attempt.settings as AttemptView['settings'] & { time_limit_minutes?: number | null }).time_limit_minutes} min`}</span>
        )}
      </section>

      {attempt.status !== 'in_progress' && !admin && (
        <section className="result-banner quiz-result-banner">
          <div style={{ width: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <span className="eyebrow">
                {attempt.pending ? 'PROVISIONAL RESULT' : 'YOUR RESULT'}
              </span>

              {reviewMode && (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    setIndex(0);
                    setListReview(true);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  style={{
                    minHeight: 34,
                    height: 34,
                    minWidth: 0,
                    padding: '0 13px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                  }}
                >
                  List View
                </button>
              )}
            </div>

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

            {!reviewMode && !listReview && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setIndex(0);
                  setReviewMode(true);
                  setListReview(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{ marginTop: 12 }}
              >
                Review Answers
              </button>
            )}
          </div>
        </section>
      )}

      {!active && !admin && !reviewMode && !listReview ? null : listReview ? (
        <>
          <section
            style={{
              marginBottom: 16,
              padding: '18px 20px',
              borderRadius: 20,
              background: 'rgba(255,255,255,0.78)',
              border: '1px solid rgba(74,48,83,0.10)',
            }}
          >
            <span className="eyebrow">
              {active ? 'BEFORE YOU SUBMIT' : 'ANSWER REVIEW'}
            </span>
            <h2 style={{ margin: '5px 0 6px' }}>
              {active ? 'Review your answers' : 'Review all answers'}
            </h2>
            <p style={{ margin: 0, opacity: 0.72, lineHeight: 1.5 }}>
              {active
                ? 'Check every question below. Select a card to return to that question and change your answer.'
                : 'All questions and your submitted answers are shown below. Select a card to open the full question review.'}
            </p>
          </section>

          <div className="quiz-list-review">
            {attempt.questions.map((question, questionIndex) => {
              const questionRevealed =
                !!question.correct &&
                (attempt.status !== 'in_progress' ||
                  (!!attempt.settings.instant && !!question.response));

              const explanationText = questionExplanation(question);

              return (
                <details
                  key={question.id}
                  className="question-panel quiz-reference-card quiz-list-review-card"
                  onToggle={(event) => {
                    const current = event.currentTarget;

                    if (!current.open) {
                      if (openReviewCard.current === current) {
                        openReviewCard.current = null;
                      }
                      return;
                    }

                    if (
                      openReviewCard.current &&
                      openReviewCard.current !== current
                    ) {
                      openReviewCard.current.open = false;
                    }

                    openReviewCard.current = current;
                  }}
                  style={{
                    borderRadius: 18,
                    position: 'relative',
                  }}
                >
                  <summary className="quiz-list-review-summary">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginBottom: 7,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          opacity: 0.65,
                        }}
                      >
                        Question {questionIndex + 1} of {totalQuestions}
                      </span>

                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          flex: '0 0 auto',
                        }}
                      >
                        {!active &&
                          question.awarded !== null &&
                          question.awarded !== undefined && (
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 800,
                                color:
                                  question.awarded === question.points
                                    ? '#18864b'
                                    : '#d53b45',
                              }}
                            >
                              {question.awarded === question.points
                                ? '✓ Correct'
                                : question.awarded > 0
                                  ? 'Partial credit'
                                  : '✕ Incorrect'}
                            </span>
                          )}
                        <span aria-hidden="true" style={{ fontSize: 16, opacity: 0.55 }}>
                          ▾
                        </span>
                      </span>
                    </div>

                    <h2
                      className="question-text quiz-reference-question"
                      style={{
                        margin: 0,
                        lineHeight: 1.35,
                        fontSize: 'clamp(15px, 3.5vw, 18px)',
                      }}
                    >
                      {question.text}
                    </h2>
                  </summary>

                  <div className="quiz-list-review-details">
                    <p
                      className="quiz-question-instruction"
                      style={{
                        margin: '14px 0 16px',
                        opacity: 0.72,
                        fontSize: 'clamp(13px, 3vw, 15px)',
                        lineHeight: 1.45,
                      }}
                    >
                      {questionInstruction(question.type)}
                    </p>

                    <ImageAttachment path={question.image_path} />

                  {question.type.startsWith('mc_') ? (
                    <div className="choices quiz-reference-choices">
                      {question.choices.map((choice, choiceIndex) => {
                        const selected = (question.response || []).includes(choice.id);
                        const correctChoice = !!question.correct?.includes(choice.id);
                        const wrongSelected =
                          questionRevealed && selected && !correctChoice;

                        const classNames = [
                          'choice',
                          'quiz-reference-choice',
                          selected ? 'selected' : '',
                          questionRevealed && correctChoice ? 'is-correct' : '',
                          wrongSelected ? 'is-incorrect' : '',
                        ]
                          .filter(Boolean)
                          .join(' ');

                        return (
                          <div key={choice.id} className={classNames}>
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
                                style={{
                                  flex: '1 1 auto',
                                  minWidth: 0,
                                  fontSize: 'clamp(14px, 3.4vw, 16px)',
                                  lineHeight: 1.4,
                                }}
                              >
                                {choice.text}
                              </span>

                              {questionRevealed && correctChoice && (
                                <span
                                  aria-label="Correct answer"
                                  title="Correct answer"
                                  style={{
                                    marginLeft: 'auto',
                                    flex: '0 0 auto',
                                    color: '#18864b',
                                    fontSize: 22,
                                    fontWeight: 800,
                                    lineHeight: 1,
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
                                    flex: '0 0 auto',
                                    color: '#d53b45',
                                    fontSize: 22,
                                    fontWeight: 800,
                                    lineHeight: 1,
                                  }}
                                >
                                  ×
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '14px 16px',
                        borderRadius: 14,
                        border: '1px solid rgba(74,48,83,0.12)',
                        background: 'rgba(255,255,255,0.72)',
                        lineHeight: 1.55,
                      }}
                    >
                      <b
                        style={{
                          display: 'block',
                          marginBottom: 5,
                          fontSize: 12,
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                          opacity: 0.65,
                        }}
                      >
                        Your answer
                      </b>
                      {responseText(question)}
                    </div>
                  )}

                  {!active &&
                    question.correct &&
                    !question.type.startsWith('mc_') && (
                      <div className="answer-key quiz-answer-key">
                        <b>Accepted answer</b>
                        <p>
                          {question.accepted
                            ?.map((accepted) => accepted.join(' / '))
                            .join('; ') || 'Manually reviewed response'}
                        </p>
                      </div>
                    )}

                  {!active &&
                    question.awarded !== null &&
                    question.awarded !== undefined &&
                    explanationText && (
                      <div
                        className="quiz-answer-explanation"
                        style={{
                          marginTop: 12,
                          padding: '12px 14px',
                          fontSize: 14,
                          lineHeight: 1.5,
                        }}
                      >
                        <b
                          style={{
                            display: 'block',
                            marginBottom: 4,
                            fontSize: 16,
                          }}
                        >
                          Explanation
                        </b>
                        <p style={{ margin: 0 }}>{explanationText}</p>
                      </div>
                    )}

                  {question.pending && (
                    <div className="notice" style={{ marginTop: 16 }}>
                      This response requires manual review; it has not been marked incorrect.
                    </div>
                  )}

                    {question.notes &&
                      (question.awarded === null ||
                        question.awarded === undefined) && (
                        <p className="quiz-admin-feedback">
                          Administrator feedback: {question.notes}
                        </p>
                      )}
                  </div>
                </details>
              );
            })}
          </div>

          <div
            className="quiz-actions quiz-reference-actions"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              marginTop: 18,
            }}
          >
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                setIndex(0);
                setReviewMode(true);
                setListReview(false);
              }}
            >
              Back to Question
            </button>

            {active ? (
              <button
                type="button"
                disabled={
                  busy ||
                  attempt.questions.some(
                    (question) =>
                      !hasCompleteAnswer(question, question.response || []),
                  )
                }
                onClick={finishAttempt}
                style={{ marginLeft: 'auto' }}
              >
                Finish Quiz
              </button>
            ) : (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={onClose}
                style={{ marginLeft: 'auto' }}
              >
                Finish Review
              </button>
            )}
          </div>

          {active &&
            attempt.questions.some(
              (question) => !hasCompleteAnswer(question, question.response || []),
            ) && (
              <p className="caption quiz-save-caption">
                Answer all unanswered questions before submitting.
              </p>
            )}
        </>
      ) : !q ? (
        <div className="empty">Answer review is not enabled for this attempt.</div>
      ) : (
        <>
          {admin && gradingComplete && (
            <div
              className="notice"
              style={{
                marginBottom: 14,
                padding: '14px 16px',
                borderRadius: 14,
              }}
            >
              <strong>Manual grading complete</strong>
              <div style={{ marginTop: 4 }}>
                No responses in this attempt are waiting for manual review.
              </div>
            </div>
          )}
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
              className="quiz-brand-header"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 18px',
                border: 'none',
                background: 'transparent',
              }}
            >
              {logoPath ? (
                <div
                  className="quiz-brand-logo"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: 0,
                    padding: 0,
                    border: 0,
                    background: 'transparent',
                    overflow: 'hidden',
                  }}
                >
                  <ImageAttachment path={logoPath} bucket="branding" />
                </div>
              ) : (
                <img
                  src="/masteryhub-review-logo.png"
                  alt="MasteryHub Review"
                  draggable={false}
                  style={{
                    display: 'block',
                    width: 360,
                    height: 100,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    transform: 'translateY(4px) scale(1.75)',
                    transformOrigin: 'center center',
                    objectFit: 'contain',
                    objectPosition: 'center center',
                    margin: 0,
                    padding: 0,
                    border: 0,
                    borderRadius: 0,
                    boxShadow: 'none',
                    background: 'transparent',
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>

            <div style={{ padding: '6px 22px 22px' }}>
            <div style={{ marginTop: 4, marginBottom: 16 }}>
              <h2
                className="question-text quiz-reference-question"
                style={{
                  marginBottom: 6,
                  lineHeight: 1.35,
                  fontSize: 'clamp(20px, 4.8vw, 25px)',
                }}
              >
                {q.text}
              </h2>
              <p
                className="quiz-question-instruction"
                style={{ margin: 0, opacity: 0.72, fontSize: 'clamp(15px, 3.5vw, 17px)', lineHeight: 1.5 }}
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
                            style={{
                              flex: '1 1 auto',
                              minWidth: 0,
                              fontSize: 'clamp(17px, 4.1vw, 19px)',
                              lineHeight: 1.45,
                            }}
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
                <div
                  className="quiz-answer-explanation"
                  style={{
                    fontSize: 22,
                    lineHeight: 1.65,
                    padding: '18px 20px',
                  }}
                >
                  <b
                    style={{
                      display: 'block',
                      fontSize: 35,
                      lineHeight: 1.35,
                      marginBottom: 8,
                    }}
                  >
                    Explanation
                  </b>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 30,
                      lineHeight: 1.65,
                    }}
                  >
                    {explanation}
                  </p>
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
                <GradeForm
                key={q.id}
                q={q}
                id={id}
                onSave={refresh}
                onSaveNext={() => saveGradeAndGoNext(q.id)}
              />
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
            </div>
            </div>
          </section>

          <div
            className="quiz-actions quiz-reference-actions"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <button
              disabled={busy || index === 0}
              className="ghost"
              onClick={() => navigate(index - 1)}
              style={{ minHeight: 72, minWidth: 150, padding: '0 38px', fontSize: 21, fontWeight: 800, borderRadius: 16 }}
            >
              Back
            </button>

            {active ? (
              index < totalQuestions - 1 ? (
                <button
                  disabled={busy || !currentQuestionAnswered}
                  onClick={() => navigate(index + 1)}
                  style={{ minHeight: 72, minWidth: 160, padding: '0 40px', fontSize: 21, fontWeight: 800, borderRadius: 16 }}
                >
                  Next →
                </button>
              ) : (
                <button
                  disabled={busy || !currentQuestionAnswered}
                  onClick={finishAttempt}
                  style={{ minHeight: 72, minWidth: 160, padding: '0 40px', fontSize: 21, fontWeight: 800, borderRadius: 16 }}
                >
                  Finish Quiz
                </button>
              )
            ) : (
              <>
                {index < totalQuestions - 1 && (
                  <button
                    disabled={busy}
                    onClick={() => navigate(index + 1)}
                    style={{ minHeight: 72, minWidth: 160, padding: '0 40px', fontSize: 21, fontWeight: 800, borderRadius: 16 }}
                  >
                    Next →
                  </button>
                )}

                {index === totalQuestions - 1 && (
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={onClose}
                    style={{
                      minHeight: 72,
                      minWidth: 190,
                      padding: '0 40px',
                      fontSize: 21,
                      fontWeight: 800,
                      borderRadius: 16,
                      marginLeft: 'auto',
                    }}
                  >
                    Finish Review
                  </button>
                )}
              </>
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
    </>
  );
}

function GradeForm({
  q,
  id,
  onSave,
  onSaveNext,
}: {
  q: PublicQuestion;
  id: string;
  onSave: () => Promise<unknown>;
  onSaveNext: () => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitGrade(
    formElement: HTMLFormElement,
    goNext: boolean,
  ) {
    const form = new FormData(formElement);
    setBusy(true);
    setMessage('');

    try {
      await rpc('grade_response', {
        attempt: id,
        question: q.id,
        points: Number(form.get('points')),
        notes: String(form.get('notes')),
      });

      if (goNext) {
        await onSaveNext();
      } else {
        await onSave();
        setMessage('Grade saved.');
      }
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grade-form stack"
      onSubmit={async (event) => {
        event.preventDefault();
        await submitGrade(event.currentTarget, false);
      }}
    >
      <div>
        <h3 style={{ marginBottom: 4 }}>Manual scoring</h3>
        {q.pending && (
          <small style={{ opacity: 0.7 }}>
            This response is waiting for manual review.
          </small>
        )}
      </div>

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

      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button type="submit" className="ghost" disabled={busy}>
          {busy ? 'Saving…' : 'Save grade'}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={async (event) => {
            const form = event.currentTarget.form;
            if (!form) return;

            if (!form.reportValidity()) return;
            await submitGrade(form, true);
          }}
        >
          {busy ? 'Saving…' : 'Save & Next →'}
        </button>
      </div>

      <Notice message={message} />
    </form>
  );
}

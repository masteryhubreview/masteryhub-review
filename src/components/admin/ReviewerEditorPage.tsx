'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db, rpc } from '@/lib/supabase';
import {
  defaultSettings,
  type QuestionData,
  type QuestionType,
  type Reviewer,
  type Settings,
} from '@/lib/types';
import {
  validateQuestion,
  validateSettings,
} from '@/lib/validation';
import {
  Check,
  ImageAttachment,
  Notice,
  uploadImage,
} from '../shared';
import ImportPanel from './ImportPanel';

type Draft = Omit<Reviewer, 'id'> & { id?: string };

type SubjectOption = {
  id: string;
  name: string;
  code: string;
};

type StudentOption = {
  id: string;
  display_name: string;
  email: string;
  student_number: string | null;
};

type ResetStudentOption = StudentOption & {
  attempt_count: number;
};

type Pick = {
  id: string;
  text: string;
  subject_id: string;
};

type QuestionDataWithExplanation = QuestionData & {
  explanation?: string;
};

type QuestionRow = {
  id?: string;
  subject_id: string;
  data: QuestionDataWithExplanation;
  is_active: boolean;
};

type ReviewerEditorPageProps = {
  reviewerId?: string;
};

type EditorTab = 'details' | 'questions';

const freshQuestion = (subjectId: string): QuestionRow => ({
  subject_id: subjectId,
  is_active: true,
  data: {
    type: 'mc_single',
    text: '',
    points: 1,
    strict: false,
    image_path: null,
    choices: [
      { id: crypto.randomUUID(), text: '' },
      { id: crypto.randomUUID(), text: '' },
    ],
    correct: [],
    accepted: [],
  },
});

function reviewerErrorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;

  if (error && typeof error === 'object') {
    const value = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
      error?: unknown;
    };

    const parts = [
      typeof value.message === 'string' ? value.message : '',
      typeof value.details === 'string' ? value.details : '',
      typeof value.hint === 'string' ? value.hint : '',
      typeof value.code === 'string' ? `Code: ${value.code}` : '',
    ].filter(Boolean);

    if (parts.length) return parts.join(' — ');
    if (typeof value.error === 'string') return value.error;

    try {
      return JSON.stringify(error);
    } catch {
      return 'Something went wrong while loading reviewer data.';
    }
  }

  return 'Something went wrong while loading reviewer data.';
}

function typeLabel(type: QuestionType) {
  const labels: Record<QuestionType, string> = {
    mc_single: 'Multiple Choice',
    mc_multi: 'Multiple Answers',
    fill_blank: 'Fill in the Blank',
    multi_blank: 'Multiple Blanks',
    short_answer: 'Short Answer',
    long_answer: 'Essay / Long Answer',
  };

  return labels[type];
}

function rememberReviewerWorkspace() {
  window.sessionStorage.setItem(
    'masteryhub:last-workspace-tab',
    'Quiz & Reviewers',
  );
  window.sessionStorage.setItem(
    'masteryhub:admin-quiz-section',
    'Reviewers',
  );
}


function toLocalDateTimeInput(value?: string | null) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const local = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return local.toISOString().slice(0, 16);
}

function toIsoOrNull(value: string) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

export default function ReviewerEditorPage({
  reviewerId,
}: ReviewerEditorPageProps) {
  const router = useRouter();

  const [tab, setTab] = useState<EditorTab>('details');

  const [draft, setDraft] = useState<Draft | null>(
    reviewerId
      ? null
      : {
          title: '',
          description: '',
          subject_id: '',
          published: false,
          settings: { ...defaultSettings },
        },
  );

  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [assignmentMode, setAssignmentMode] =
    useState<'all' | 'selected'>('selected');
  const [assignedStudentIds, setAssignedStudentIds] =
    useState<string[]>([]);
  const [eligibleStudents, setEligibleStudents] =
    useState<StudentOption[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [studentsBusy, setStudentsBusy] = useState(false);
  const [selected, setSelected] = useState<Pick[]>([]);
  const [randomPoolCount, setRandomPoolCount] = useState(0);

  const [questionRows, setQuestionRows] = useState<Pick[]>([]);
  const [questionSearch, setQuestionSearch] = useState('');
  const [questionImportOpen, setQuestionImportOpen] = useState(false);
  const [questionImportSubjectId, setQuestionImportSubjectId] = useState('');
  const [selectedQuestionSearch, setSelectedQuestionSearch] = useState('');
  const [expandedSelectedQuestion, setExpandedSelectedQuestion] = useState<string | null>(null);
  const [questionVersion, setQuestionVersion] = useState(0);

  const [editingQuestion, setEditingQuestion] =
    useState<QuestionRow | null>(null);
  const [accepted, setAccepted] = useState('');

  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [resetAttemptsOpen, setResetAttemptsOpen] = useState(false);
  const [resetAttemptsMode, setResetAttemptsMode] =
    useState<'student' | 'all'>('student');
  const [resetStudentId, setResetStudentId] = useState('');
  const [resetStudentSearch, setResetStudentSearch] = useState('');
  const [resetStudents, setResetStudents] =
    useState<ResetStudentOption[]>([]);
  const [resetAttemptsBusy, setResetAttemptsBusy] = useState(false);

  // Functional reviewer rules. Secret access-code data is stored separately
  // in reviewer_rules and is never exposed through the student-readable reviewer row.
  const [cosmeticRules, setCosmeticRules] = useState({
    timeLimitEnabled: false,
    timeLimitMinutes: '',
    accessCodeEnabled: false,
    accessCode: '',
    showCorrectFrom: '',
    hideCorrectAt: '',
    availableFrom: '',
    availableUntil: '',
    dueAt: '',
    notifyOnChange: false,
  });

  const [subjectSearch, setSubjectSearch] = useState('');
  const [changingSubjects, setChangingSubjects] = useState(!reviewerId);

  const subjectMap = useMemo(
    () => new Map(subjects.map((subject) => [subject.id, subject])),
    [subjects],
  );

  const filteredSubjectOptions = useMemo(() => {
    const query = subjectSearch.trim().toLowerCase();

    return subjects
      .filter((subject) => !selectedSubjects.includes(subject.id))
      .filter((subject) => {
        if (!query) return true;

        return (
          subject.name.toLowerCase().includes(query) ||
          subject.code.toLowerCase().includes(query)
        );
      })
      .slice(0, 8);
  }, [subjects, selectedSubjects, subjectSearch]);

  const filteredEligibleStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();

    return eligibleStudents.filter((student) => {
      if (!query) return true;

      return (
        student.display_name.toLowerCase().includes(query) ||
        student.email.toLowerCase().includes(query) ||
        (student.student_number || '').toLowerCase().includes(query)
      );
    });
  }, [eligibleStudents, studentSearch]);

  const filteredResetStudents = useMemo(() => {
    const query = resetStudentSearch.trim().toLowerCase();

    if (!query) return resetStudents;

    return resetStudents.filter((student) => (
      student.display_name.toLowerCase().includes(query) ||
      student.email.toLowerCase().includes(query) ||
      (student.student_number || '').toLowerCase().includes(query)
    ));
  }, [resetStudents, resetStudentSearch]);

  const filteredSelectedQuestions = useMemo(() => {
    const query = selectedQuestionSearch.trim().toLowerCase();

    if (!query) return selected;

    return selected.filter((question) =>
      question.text.toLowerCase().includes(query),
    );
  }, [selected, selectedQuestionSearch]);

  function backToReviewers() {
    rememberReviewerWorkspace();
    router.push('/');
  }

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await db().auth.getSession();

        if (sessionError) throw sessionError;

        if (!session?.user) {
          router.replace('/');
          return;
        }

        const { data: profile, error: profileError } = await db()
          .from('profiles')
          .select('role,is_active')
          .eq('id', session.user.id)
          .single();

        if (profileError) throw profileError;

        if (!profile?.is_active || profile.role !== 'admin') {
          router.replace('/');
          return;
        }

        const { data: subjectData, error: subjectError } = await db()
          .from('subjects')
          .select('id,name,code')
          .eq('is_active', true)
          .order('name');

        if (subjectError) throw subjectError;
        if (!live) return;

        setSubjects((subjectData || []) as SubjectOption[]);

        if (!reviewerId) {
          setLoading(false);
          return;
        }

        const { data: reviewer, error: reviewerError } = await db()
          .from('reviewers')
          .select('*')
          .eq('id', reviewerId)
          .single();

        if (reviewerError) throw reviewerError;

        const [rules, assignment] = await Promise.all([
          rpc<{
            time_limit_minutes: number | null;
            access_code_enabled: boolean;
            show_correct_from: string | null;
            hide_correct_at: string | null;
            available_from: string | null;
            available_until: string | null;
            due_at: string | null;
          }>('get_reviewer_rules', {
            reviewer: reviewerId,
          }),
          rpc<{
            mode: 'all' | 'selected';
            student_ids: string[];
          }>('get_reviewer_assignment', {
            reviewer: reviewerId,
          }),
        ]);

        const { data: links, error: linksError } = await db()
          .from('reviewer_subjects')
          .select('subject_id')
          .eq('reviewer_id', reviewerId)
          .order('position');

        if (linksError) throw linksError;

        const pool: Pick[] = [];

        for (let pageNumber = 0; ; pageNumber += 1) {
          const { data, error } = await db()
            .from('reviewer_questions')
            .select('question_id,questions(subject_id,data)')
            .eq('reviewer_id', reviewerId)
            .order('position')
            .range(pageNumber * 500, pageNumber * 500 + 499);

          if (error) throw error;

          pool.push(
            ...(
              (data || []) as unknown as {
                question_id: string;
                questions: {
                  subject_id: string;
                  data: { text: string };
                };
              }[]
            ).map((item) => ({
              id: item.question_id,
              subject_id: item.questions.subject_id,
              text: item.questions.data.text,
            })),
          );

          if ((data || []).length < 500) break;
        }

        if (!live) return;

        const subjectIds = (links || []).map((item) => item.subject_id);

        const reviewerSubjectIds =
          subjectIds.length
            ? subjectIds
            : reviewer.subject_id
              ? [reviewer.subject_id]
              : [];

        setSelectedSubjects(reviewerSubjectIds);
        setQuestionImportSubjectId(reviewerSubjectIds[0] || '');
        setSelected(pool);
        setDraft(reviewer as Reviewer);
        setAssignmentMode(
          assignment.mode === 'selected' ? 'selected' : 'all',
        );
        setAssignedStudentIds(assignment.student_ids || []);
        setCosmeticRules({
          timeLimitEnabled: !!rules.time_limit_minutes,
          timeLimitMinutes: rules.time_limit_minutes
            ? String(rules.time_limit_minutes)
            : '',
          accessCodeEnabled: !!rules.access_code_enabled,
          accessCode: '',
          showCorrectFrom: toLocalDateTimeInput(
            rules.show_correct_from,
          ),
          hideCorrectAt: toLocalDateTimeInput(
            rules.hide_correct_at,
          ),
          availableFrom: toLocalDateTimeInput(
            rules.available_from,
          ),
          availableUntil: toLocalDateTimeInput(
            rules.available_until,
          ),
          dueAt: toLocalDateTimeInput(rules.due_at),
          notifyOnChange: false,
        });
        setLoading(false);
      } catch (error) {
        if (live) {
          setMessage(reviewerErrorText(error));
          setLoading(false);
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [reviewerId, router]);

  useEffect(() => {
    let live = true;

    async function loadEligibleStudents() {
      if (!selectedSubjects.length) {
        setEligibleStudents([]);
        setAssignedStudentIds([]);
        return;
      }

      setStudentsBusy(true);

      try {
        const { data: enrollmentRows, error: enrollmentError } =
          await db()
            .from('enrollments')
            .select('student_id')
            .in('subject_id', selectedSubjects)
            .eq('is_active', true);

        if (enrollmentError) throw enrollmentError;

        const studentIds = Array.from(
          new Set(
            (enrollmentRows || [])
              .map((row) => row.student_id)
              .filter(Boolean),
          ),
        );

        if (!studentIds.length) {
          if (live) {
            setEligibleStudents([]);
            setAssignedStudentIds([]);
          }
          return;
        }

        const { data: profileRows, error: profileError } = await db()
          .from('profiles')
          .select('id,display_name,email,student_number')
          .in('id', studentIds)
          .eq('role', 'student')
          .eq('is_active', true)
          .order('display_name');

        if (profileError) throw profileError;

        if (live) {
          const rows = (profileRows || []) as StudentOption[];
          const validIds = new Set(rows.map((student) => student.id));

          setEligibleStudents(rows);
          setAssignedStudentIds((current) =>
            current.filter((id) => validIds.has(id)),
          );
        }
      } catch (error) {
        if (live) setMessage(reviewerErrorText(error));
      } finally {
        if (live) setStudentsBusy(false);
      }
    }

    void loadEligibleStudents();

    return () => {
      live = false;
    };
  }, [selectedSubjects.join('|')]);

  useEffect(() => {
    if (!selectedSubjects.length) {
      setQuestionRows([]);
      setRandomPoolCount(0);
      return;
    }

    let live = true;
    const timer = setTimeout(async () => {
      try {
        let query = db()
          .from('questions')
          .select('id,subject_id,data')
          .eq('is_active', true)
          .in('subject_id', selectedSubjects)
          .order('created_at', { ascending: false })
          .limit(250);

        if (questionSearch) {
          query = query.ilike(
            'data->>text',
            `%${questionSearch.replaceAll('%', '').replaceAll('_', '')}%`,
          );
        }

        const { data, error } = await query;
        if (error) throw error;

        if (live) {
          const mapped = (data || []).map((row) => ({
            id: row.id,
            subject_id: row.subject_id,
            text: row.data.text,
          }));

          setQuestionRows(mapped);
        }

        const { count, error: countError } = await db()
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .in('subject_id', selectedSubjects);

        if (countError) throw countError;
        if (live) setRandomPoolCount(count || 0);
      } catch (error) {
        if (live) setMessage(reviewerErrorText(error));
      }
    }, 220);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    selectedSubjects.join('|'),
    questionSearch,
    questionVersion,
  ]);

  function setting<K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            settings: { ...current.settings, [key]: value },
          }
        : current,
    );
  }

  function addSubject(subjectId: string) {
    setSelectedSubjects((current) =>
      current.includes(subjectId) ? current : [...current, subjectId],
    );
    setQuestionImportSubjectId((current) => current || subjectId);
    setSubjectSearch('');
  }

  function removeSubject(subjectId: string) {
    setSelectedSubjects((current) => {
      const next = current.filter((id) => id !== subjectId);

      setSelected((questions) =>
        questions.filter((question) => next.includes(question.subject_id)),
      );

      if (
        editingQuestion &&
        !next.includes(editingQuestion.subject_id)
      ) {
        setEditingQuestion(null);
        setAccepted('');
      }

      return next;
    });
  }

  function questionField<K extends keyof QuestionDataWithExplanation>(
    key: K,
    value: QuestionDataWithExplanation[K],
  ) {
    setEditingQuestion((row) =>
      row
        ? {
            ...row,
            data: {
              ...row.data,
              [key]: value,
            },
          }
        : row,
    );
  }

  function beginNewQuestion() {
    if (!selectedSubjects.length) {
      setMessage('Select at least one subject in Details first.');
      setTab('details');
      return;
    }

    setMessage('');
    setAccepted('');
    setEditingQuestion(freshQuestion(selectedSubjects[0]));
  }


  async function deleteBankQuestion(question: Pick) {
    const confirmed = window.confirm(
      `Delete "${question.text}" from the Question Bank? This cannot be undone.`,
    );

    if (!confirmed) return;

    setBusy(true);
    setMessage('');

    try {
      const { count, error: usageError } = await db()
        .from('reviewer_questions')
        .select('reviewer_id', { count: 'exact', head: true })
        .eq('question_id', question.id);

      if (usageError) throw usageError;

      if ((count || 0) > 0) {
        throw new Error(
          'This question is already attached to a reviewer. Remove it from the reviewer first, then delete it from the Question Bank.',
        );
      }

      const { error } = await db()
        .from('questions')
        .delete()
        .eq('id', question.id);

      if (error) throw error;

      setQuestionRows((current) =>
        current.filter((item) => item.id !== question.id),
      );
      setSelected((current) =>
        current.filter((item) => item.id !== question.id),
      );

      setMessage('Question deleted from the Question Bank.');
    } catch (error) {
      setMessage(reviewerErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function openQuestionEditor(questionId: string) {
    if (editingQuestion?.id === questionId) {
      setEditingQuestion(null);
      setAccepted('');
      return;
    }

    setMessage('');

    try {
      const { data, error } = await db()
        .from('questions')
        .select('id,subject_id,data,is_active')
        .eq('id', questionId)
        .single();

      if (error) throw error;

      const row = data as QuestionRow;

      setEditingQuestion(row);
      setAccepted(
        (row.data.accepted || [])
          .map((items) => items.join(' | '))
          .join('\n'),
      );
    } catch (error) {
      setMessage(reviewerErrorText(error));
    }
  }

  async function saveQuestion() {
    if (!editingQuestion) return;

    setBusy(true);
    setMessage('');

    try {
      const question: QuestionDataWithExplanation = {
        ...editingQuestion.data,
        explanation: editingQuestion.data.explanation?.trim() || '',
        accepted: accepted.trim()
          ? accepted
              .split('\n')
              .map((line) =>
                line
                  .split('|')
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
              .filter((row) => row.length)
          : [],
      };

      if (question.type.startsWith('mc_')) {
        question.accepted = [];
      } else {
        question.choices = [];
        question.correct = [];
      }

      if (question.type === 'long_answer') {
        question.accepted = [];
      }

      const errors = validateQuestion(question);
      if (errors.length) {
        throw new Error(errors.join('; '));
      }

      const payload = {
        ...editingQuestion,
        data: question,
      };

      const { data, error } = await db()
        .from('questions')
        .upsert(payload)
        .select('id,subject_id,data')
        .single();

      if (error) throw error;

      const saved: Pick = {
        id: data.id,
        subject_id: data.subject_id,
        text: data.data.text,
      };

      if (draft?.settings.selection === 'fixed') {
        setSelected((current) => {
          const exists = current.some((item) => item.id === saved.id);
          return exists
            ? current.map((item) =>
                item.id === saved.id ? saved : item,
              )
            : [...current, saved];
        });
      }

      setEditingQuestion(null);
      setAccepted('');
      setExpandedSelectedQuestion(null);
      setQuestionVersion((value) => value + 1);
      setMessage(
        draft?.settings.selection === 'fixed'
          ? 'Question saved and added to this reviewer.'
          : 'Question saved to the selected subject question pool.',
      );
    } catch (error) {
      setMessage(reviewerErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function randomQuestionIds() {
    const ids: string[] = [];

    for (let pageNumber = 0; ; pageNumber += 1) {
      const { data, error } = await db()
        .from('questions')
        .select('id')
        .eq('is_active', true)
        .in('subject_id', selectedSubjects)
        .order('created_at', { ascending: false })
        .range(
          pageNumber * 500,
          pageNumber * 500 + 499,
        );

      if (error) throw error;

      ids.push(...(data || []).map((item) => item.id));

      if ((data || []).length < 500) break;
    }

    return ids;
  }

  async function openResetAttempts() {
    if (!draft?.id) return;

    setResetAttemptsBusy(true);
    setMessage('');

    try {
      const allAttempts: { student_id: string }[] = [];

      for (let pageNumber = 0; ; pageNumber += 1) {
        const { data, error } = await db()
          .from('attempts')
          .select('student_id')
          .eq('reviewer_id', draft.id)
          .range(pageNumber * 500, pageNumber * 500 + 499);

        if (error) throw error;

        allAttempts.push(
          ...((data || []) as { student_id: string }[]),
        );

        if ((data || []).length < 500) break;
      }

      const counts = new Map<string, number>();

      for (const attempt of allAttempts) {
        counts.set(
          attempt.student_id,
          (counts.get(attempt.student_id) || 0) + 1,
        );
      }

      const studentIds = Array.from(counts.keys());

      if (!studentIds.length) {
        setResetStudents([]);
        setResetStudentId('');
        setResetStudentSearch('');
        setResetAttemptsMode('student');
        setResetAttemptsOpen(true);
        return;
      }

      const { data: profiles, error: profilesError } = await db()
        .from('profiles')
        .select('id,display_name,email,student_number')
        .in('id', studentIds)
        .order('display_name');

      if (profilesError) throw profilesError;

      setResetStudents(
        ((profiles || []) as StudentOption[]).map((student) => ({
          ...student,
          attempt_count: counts.get(student.id) || 0,
        })),
      );
      setResetStudentId('');
      setResetStudentSearch('');
      setResetAttemptsMode('student');
      setResetAttemptsOpen(true);
    } catch (error) {
      setMessage(reviewerErrorText(error));
    } finally {
      setResetAttemptsBusy(false);
    }
  }

  async function confirmResetAttempts() {
    if (!draft?.id) return;

    if (
      resetAttemptsMode === 'student' &&
      !resetStudentId
    ) {
      setMessage('Select a student to reset.');
      return;
    }

    const warning =
      resetAttemptsMode === 'all'
        ? 'Reset attempts for ALL students who have taken this reviewer? Their previous answers and results for this reviewer will be permanently deleted.'
        : 'Reset this student’s attempts? Their previous answers and results for this reviewer will be permanently deleted.';

    if (!window.confirm(warning)) return;

    setResetAttemptsBusy(true);
    setMessage('');

    try {
      const deleted = await rpc<number>(
        'reset_reviewer_attempts',
        {
          reviewer: draft.id,
          student:
            resetAttemptsMode === 'student'
              ? resetStudentId
              : null,
          reset_all: resetAttemptsMode === 'all',
        },
      );

      setResetAttemptsOpen(false);
      setResetStudentId('');
      setResetStudentSearch('');
      setResetStudents([]);

      setMessage(
        deleted === 1
          ? '1 attempt was reset. The student can start again from Attempt 1.'
          : `${deleted} attempts were reset. The affected student${
              resetAttemptsMode === 'all' ? 's' : ''
            } can start again from Attempt 1.`,
      );
    } catch (error) {
      setMessage(reviewerErrorText(error));
    } finally {
      setResetAttemptsBusy(false);
    }
  }

  async function saveReviewer(publishOverride?: boolean) {
    if (!draft) return;

    setBusy(true);
    setMessage('');

    try {
      const errors = validateSettings(draft.settings);

      if (!draft.title.trim()) {
        errors.push('Reviewer title is required');
      }

      if (!selectedSubjects.length) {
        errors.push('Select at least one subject');
      }

      const publish =
        typeof publishOverride === 'boolean'
          ? publishOverride
          : draft.published;

      const questionIds =
        draft.settings.selection === 'fixed'
          ? selected.map((question) => question.id)
          : await randomQuestionIds();

      if (
        draft.settings.selection === 'fixed' &&
        questionIds.length === 0 &&
        publish
      ) {
        errors.push(
          'Add at least one question before publishing',
        );
      }

      if (
        draft.settings.selection === 'random' &&
        draft.settings.count > questionIds.length
      ) {
        errors.push(
          `Only ${questionIds.length} active questions are available across the selected subjects`,
        );
      }

      if (
        assignmentMode === 'selected' &&
        assignedStudentIds.length === 0
      ) {
        errors.push('Select at least one student under Assign');
      }

      if (cosmeticRules.timeLimitEnabled) {
        const minutes = Number(cosmeticRules.timeLimitMinutes);

        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
          errors.push('Time limit must be between 1 and 1440 minutes');
        }
      }

      if (
        cosmeticRules.availableFrom &&
        cosmeticRules.availableUntil &&
        new Date(cosmeticRules.availableUntil) <=
          new Date(cosmeticRules.availableFrom)
      ) {
        errors.push('"Until" must be later than "Available from"');
      }

      if (
        cosmeticRules.showCorrectFrom &&
        cosmeticRules.hideCorrectAt &&
        new Date(cosmeticRules.hideCorrectAt) <=
          new Date(cosmeticRules.showCorrectFrom)
      ) {
        errors.push(
          '"Hide Correct Answers At" must be later than "Show Correct Answers At"',
        );
      }

      if (errors.length) {
        throw new Error(errors.join('; '));
      }

      const savedReviewerId = await rpc<string>('save_reviewer', {
        reviewer: draft.id || null,
        subjects: selectedSubjects,
        name: draft.title.trim(),
        description_text: draft.description,
        options: draft.settings,
        question_ids: questionIds,
        publish,
      });

      await rpc('save_reviewer_assignment', {
        reviewer: savedReviewerId,
        assignment_mode: assignmentMode,
        student_ids:
          assignmentMode === 'selected'
            ? assignedStudentIds
            : [],
      });

      await rpc('save_reviewer_rules', {
        reviewer: savedReviewerId,
        time_limit_minutes: cosmeticRules.timeLimitEnabled
          ? Number(cosmeticRules.timeLimitMinutes)
          : null,
        access_code_enabled: cosmeticRules.accessCodeEnabled,
        access_code: cosmeticRules.accessCode.trim(),
        show_correct_from: toIsoOrNull(
          cosmeticRules.showCorrectFrom,
        ),
        hide_correct_at: toIsoOrNull(
          cosmeticRules.hideCorrectAt,
        ),
        available_from: toIsoOrNull(
          cosmeticRules.availableFrom,
        ),
        available_until: toIsoOrNull(
          cosmeticRules.availableUntil,
        ),
        due_at: toIsoOrNull(cosmeticRules.dueAt),
        notify_students: cosmeticRules.notifyOnChange,
      });

      rememberReviewerWorkspace();
      router.push('/');
    } catch (error) {
      setMessage(reviewerErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !draft) {
    return (
      <main className="reviewer-route-page">
        <div className="reviewer-route-content">
          <button
            type="button"
            className="ghost reviewer-back-button"
            onClick={backToReviewers}
          >
            ← Back to Reviewers
          </button>

          <p>
            {loading
              ? 'Opening reviewer…'
              : 'Reviewer could not be opened.'}
          </p>

          <Notice message={message} />
        </div>
      </main>
    );
  }

  return (
    <main className="reviewer-route-page">
      <div className="reviewer-route-content">
        <header className="reviewer-route-header">
          <button
            type="button"
            className="ghost reviewer-back-button"
            onClick={backToReviewers}
          >
            ← Back to Reviewers
          </button>

          <div className="reviewer-route-heading">
            <div>
              <span className="eyebrow">
                QUIZ & REVIEWER SETUP
              </span>
              <h1>
                {reviewerId
                  ? 'Edit reviewer'
                  : 'Create reviewer'}
              </h1>
            </div>

            <div className="reviewer-publish-state">
              <span
                className={`reviewer-state-dot ${
                  draft.published ? 'is-published' : ''
                }`}
              />
              {draft.published
                ? 'Published'
                : 'Not published'}
            </div>
          </div>
        </header>

        <Notice message={message} />

        <nav
          className="reviewer-editor-tabs"
          aria-label="Reviewer editor"
        >
          <button
            type="button"
            className={tab === 'details' ? 'active' : ''}
            onClick={() => setTab('details')}
          >
            Details
          </button>

          <button
            type="button"
            className={tab === 'questions' ? 'active' : ''}
            onClick={() => setTab('questions')}
          >
            Questions
            <span className="reviewer-tab-count">
              {draft.settings.selection === 'fixed'
                ? selected.length
                : randomPoolCount}
            </span>
          </button>
        </nav>

        <div className="reviewer-editor-shell">
          {tab === 'details' ? (
            <div className="reviewer-canvas-details">
              <section className="reviewer-canvas-card">
                <label className="reviewer-canvas-title-field">
                  Reviewer title
                  <input
                    required
                    placeholder="Reviewer title"
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        title: event.target.value,
                      })
                    }
                  />
                </label>

                <label className="reviewer-canvas-description-field">
                  Instructions / introduction
                  <textarea
                    rows={7}
                    placeholder="Add instructions or notes students should read before starting."
                    value={draft.description}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        description: event.target.value,
                      })
                    }
                  />
                </label>
              </section>

              <section className="reviewer-canvas-card">
                <h2>Reviewer Settings</h2>

                <div className="reviewer-canvas-setting-row reviewer-subject-setting-row">
                  <span>Subjects</span>

                  <div className="reviewer-subject-control">
                    {reviewerId && !changingSubjects ? (
                      <div className="reviewer-subject-current-row">
                        <div className="reviewer-subject-current-list">
                          {selectedSubjects.length ? (
                            selectedSubjects.map((subjectId) => {
                              const subject = subjectMap.get(subjectId);

                              return (
                                <span
                                  key={subjectId}
                                  className="reviewer-subject-current-chip"
                                >
                                  <strong>{subject?.name || 'Subject'}</strong>
                                  {subject?.code && <small>{subject.code}</small>}
                                </span>
                              );
                            })
                          ) : (
                            <span className="reviewer-subject-none">
                              No subject attached
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          className="ghost reviewer-subject-change-button"
                          onClick={() => {
                            setChangingSubjects(true);
                            setSubjectSearch('');
                          }}
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <div className="reviewer-subject-search-box">
                        {!!selectedSubjects.length && (
                          <div className="reviewer-subject-selected-list">
                            {selectedSubjects.map((subjectId) => {
                              const subject = subjectMap.get(subjectId);

                              return (
                                <div
                                  key={subjectId}
                                  className="reviewer-subject-selected-item"
                                >
                                  <span>
                                    <strong>{subject?.name || 'Subject'}</strong>
                                    {subject?.code && <small>{subject.code}</small>}
                                  </span>

                                  <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Remove ${subject?.name || 'subject'}`}
                                    className="reviewer-subject-remove"
                                    onClick={() => removeSubject(subjectId)}
                                    onKeyDown={(event) => {
                                      if (
                                        event.key === 'Enter' ||
                                        event.key === ' '
                                      ) {
                                        event.preventDefault();
                                        removeSubject(subjectId);
                                      }
                                    }}
                                  >
                                    ×
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="reviewer-subject-search-wrap">
                          <input
                            type="search"
                            placeholder="Search subject name or code"
                            value={subjectSearch}
                            onChange={(event) =>
                              setSubjectSearch(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === 'Enter' &&
                                filteredSubjectOptions.length
                              ) {
                                event.preventDefault();
                                addSubject(filteredSubjectOptions[0].id);
                              }
                            }}
                          />

                          {subjectSearch.trim() && (
                            <div className="reviewer-subject-search-results">
                              {filteredSubjectOptions.length ? (
                                filteredSubjectOptions.map((subject) => (
                                  <div
                                    key={subject.id}
                                    role="button"
                                    tabIndex={0}
                                    className="reviewer-subject-search-result"
                                    onClick={() => addSubject(subject.id)}
                                    onKeyDown={(event) => {
                                      if (
                                        event.key === 'Enter' ||
                                        event.key === ' '
                                      ) {
                                        event.preventDefault();
                                        addSubject(subject.id);
                                      }
                                    }}
                                  >
                                    <span>
                                      <strong>{subject.name}</strong>
                                      <small>{subject.code}</small>
                                    </span>
                                    <b>Add</b>
                                  </div>
                                ))
                              ) : (
                                <div className="reviewer-subject-search-empty">
                                  No matching subjects
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {reviewerId && (
                          <div className="reviewer-subject-change-actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => {
                                setChangingSubjects(false);
                                setSubjectSearch('');
                              }}
                            >
                              Done
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="reviewer-canvas-setting-row">
                  <span>Question mode</span>

                  <select
                    value={draft.settings.selection}
                    onChange={(event) =>
                      setting(
                        'selection',
                        event.target.value as
                          | 'fixed'
                          | 'random',
                      )
                    }
                  >
                    <option value="fixed">
                      Individual / fixed questions
                    </option>
                    <option value="random">
                      Randomized question pool
                    </option>
                  </select>
                </div>

                {draft.settings.selection === 'random' && (
                  <div className="reviewer-canvas-setting-row">
                    <span>Questions per attempt</span>

                    <input
                      className="reviewer-canvas-small-input"
                      type="number"
                      min="1"
                      value={draft.settings.count}
                      onChange={(event) =>
                        setting(
                          'count',
                          Number(event.target.value),
                        )
                      }
                    />
                  </div>
                )}

                <div className="reviewer-canvas-setting-row">
                  <span>Options</span>

                  <div className="reviewer-canvas-options">
                    <Check
                      label="Shuffle question order"
                      checked={
                        draft.settings.shuffle_questions
                      }
                      onChange={(value) =>
                        setting(
                          'shuffle_questions',
                          value,
                        )
                      }
                    />

                    <Check
                      label="Shuffle answer choices"
                      checked={
                        draft.settings.shuffle_choices
                      }
                      onChange={(value) =>
                        setting(
                          'shuffle_choices',
                          value,
                        )
                      }
                    />

                    <Check
                      label="Require all answers"
                      checked={draft.settings.require_all}
                      onChange={(value) =>
                        setting('require_all', value)
                      }
                    />
                  </div>
                </div>

                <div className="reviewer-canvas-setting-row">
                  <span>Time Limit</span>

                  <div className="reviewer-canvas-options">
                    <label className="reviewer-canvas-inline-check">
                      <input
                        type="checkbox"
                        checked={cosmeticRules.timeLimitEnabled}
                        onChange={(event) =>
                          setCosmeticRules((current) => ({
                            ...current,
                            timeLimitEnabled: event.target.checked,
                          }))
                        }
                      />
                      <span>Time Limit</span>
                    </label>

                    {cosmeticRules.timeLimitEnabled && (
                      <label className="reviewer-canvas-inline-field">
                        <input
                          type="number"
                          min="1"
                          placeholder="60"
                          value={cosmeticRules.timeLimitMinutes}
                          onChange={(event) =>
                            setCosmeticRules((current) => ({
                              ...current,
                              timeLimitMinutes: event.target.value,
                            }))
                          }
                        />
                        <span>Minutes</span>
                      </label>
                    )}

                    <small className="reviewer-cosmetic-note">
                      Students will see a countdown. The attempt auto-submits when time runs out.
                    </small>
                  </div>
                </div>

                <div className="reviewer-canvas-setting-row">
                  <span>Attempts</span>

                  <div className="reviewer-canvas-attempts">
                    <label>
                      Maximum attempts
                      <input
                        type="number"
                        min="1"
                        placeholder="Unlimited"
                        value={
                          draft.settings.max_attempts ?? ''
                        }
                        onChange={(event) =>
                          setting(
                            'max_attempts',
                            event.target.value
                              ? Number(
                                  event.target.value,
                                )
                              : null,
                          )
                        }
                      />
                    </label>

                    {draft.id && (
                      <div className="reviewer-reset-attempts-action">
                        <button
                          type="button"
                          className="ghost reviewer-reset-attempts-button"
                          disabled={resetAttemptsBusy}
                          onClick={() => void openResetAttempts()}
                        >
                          {resetAttemptsBusy
                            ? 'Loading…'
                            : 'Reset / Restart Attempts'}
                        </button>

                        <small className="reviewer-cosmetic-note">
                          Reset a student&apos;s previous attempts so they can
                          take this reviewer again from Attempt 1.
                        </small>
                      </div>
                    )}
                  </div>
                </div>

                <div className="reviewer-canvas-setting-row">
                  <span>Student feedback</span>

                  <div className="reviewer-canvas-options">
                    <Check
                      label="Instant answer feedback"
                      checked={draft.settings.instant}
                      onChange={(value) =>
                        setting('instant', value)
                      }
                    />

                    <Check
                      label="Allow completed answer review"
                      checked={
                        draft.settings.allow_review
                      }
                      onChange={(value) =>
                        setting(
                          'allow_review',
                          value,
                        )
                      }
                    />

                    <Check
                      label="Reveal correct answers"
                      checked={
                        draft.settings.show_correct
                      }
                      onChange={(value) =>
                        setting(
                          'show_correct',
                          value,
                        )
                      }
                    />

                    <div className="reviewer-canvas-schedule-box">
                      <label>
                        Show Correct Answers At
                        <input
                          type="datetime-local"
                          value={cosmeticRules.showCorrectFrom}
                          onChange={(event) =>
                            setCosmeticRules((current) => ({
                              ...current,
                              showCorrectFrom: event.target.value,
                            }))
                          }
                        />
                      </label>

                      <label>
                        Hide Correct Answers At
                        <input
                          type="datetime-local"
                          value={cosmeticRules.hideCorrectAt}
                          onChange={(event) =>
                            setCosmeticRules((current) => ({
                              ...current,
                              hideCorrectAt: event.target.value,
                            }))
                          }
                        />
                      </label>

                      <small className="reviewer-cosmetic-note">
                        Correct answers are only revealed inside this scheduled window.
                      </small>
                    </div>
                  </div>
                </div>

                <div className="reviewer-canvas-setting-row">
                  <span>Quiz Restrictions</span>

                  <div className="reviewer-canvas-options">
                    <label className="reviewer-canvas-inline-check">
                      <input
                        type="checkbox"
                        checked={cosmeticRules.accessCodeEnabled}
                        onChange={(event) =>
                          setCosmeticRules((current) => ({
                            ...current,
                            accessCodeEnabled: event.target.checked,
                          }))
                        }
                      />
                      <span>Require an access code</span>
                    </label>

                    {cosmeticRules.accessCodeEnabled && (
                      <input
                        type="text"
                        placeholder={reviewerId ? "Enter a new code to change it" : "Access code"}
                        value={cosmeticRules.accessCode}
                        onChange={(event) =>
                          setCosmeticRules((current) => ({
                            ...current,
                            accessCode: event.target.value,
                          }))
                        }
                      />
                    )}

                    <small className="reviewer-cosmetic-note">
                      Students must be enrolled and enter the correct access code before starting.
                    </small>
                  </div>
                </div>

                <div className="reviewer-canvas-setting-row">
                  <span>Assign</span>

                  <div className="reviewer-canvas-assignment-box">
                    <div className="reviewer-assign-control reviewer-assign-search-control">
                      <span className="reviewer-assign-label">Assign to</span>

                      <div className="reviewer-assign-combobox">
                        <div
                          className="reviewer-assign-trigger"
                          role="button"
                          tabIndex={0}
                          aria-expanded={studentPickerOpen}
                          onClick={() =>
                            setStudentPickerOpen((current) => !current)
                          }
                          onKeyDown={(event) => {
                            if (
                              event.key === 'Enter' ||
                              event.key === ' '
                            ) {
                              event.preventDefault();
                              setStudentPickerOpen(
                                (current) => !current,
                              );
                            }
                          }}
                        >
                          <span className="reviewer-assign-trigger-copy">
                            <strong>
                              {assignmentMode === 'all'
                                ? 'All enrolled students'
                                : assignedStudentIds.length === 1
                                  ? '1 student selected'
                                  : `${assignedStudentIds.length} students selected`}
                            </strong>
                            <small>
                              {assignmentMode === 'all'
                                ? 'Selected subject(s)'
                                : 'Click to change students'}
                            </small>
                          </span>

                          <span
                            className={`reviewer-assign-chevron ${
                              studentPickerOpen ? 'is-open' : ''
                            }`}
                            aria-hidden="true"
                          >
                            ▾
                          </span>
                        </div>

                        {studentPickerOpen && (
                          <div className="reviewer-assign-dropdown">
                            <div
                              className={`reviewer-assign-all-option ${
                                assignmentMode === 'all'
                                  ? 'is-selected'
                                  : ''
                              }`}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setAssignmentMode('all');
                                setAssignedStudentIds([]);
                                setStudentSearch('');
                                setStudentPickerOpen(false);
                              }}
                              onKeyDown={(event) => {
                                if (
                                  event.key === 'Enter' ||
                                  event.key === ' '
                                ) {
                                  event.preventDefault();
                                  setAssignmentMode('all');
                                  setAssignedStudentIds([]);
                                  setStudentSearch('');
                                  setStudentPickerOpen(false);
                                }
                              }}
                            >
                              <span className="reviewer-assign-option-radio">
                                {assignmentMode === 'all' ? '●' : '○'}
                              </span>

                              <span>
                                <strong>All enrolled students</strong>
                                <small>
                                  Everyone enrolled in the selected subject(s)
                                </small>
                              </span>
                            </div>

                            <div className="reviewer-assign-search-wrap">
                              <input
                                type="search"
                                autoFocus
                                placeholder="Search student name, email, or number"
                                value={studentSearch}
                                onChange={(event) => {
                                  setAssignmentMode('selected');
                                  setStudentSearch(event.target.value);
                                }}
                              />

                              {assignmentMode === 'selected' && (
                                <span className="reviewer-assign-selected-count">
                                  {assignedStudentIds.length} selected
                                </span>
                              )}
                            </div>

                            <div className="reviewer-student-check-list reviewer-assign-dropdown-list">
                              {studentsBusy ? (
                                <div className="reviewer-student-empty">
                                  Loading students…
                                </div>
                              ) : filteredEligibleStudents.length ? (
                                filteredEligibleStudents.map((student) => {
                                  const checked =
                                    assignedStudentIds.includes(student.id);

                                  return (
                                    <label
                                      className="reviewer-student-check-row reviewer-assign-dropdown-row"
                                      key={student.id}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(event) => {
                                          setAssignmentMode('selected');
                                          setAssignedStudentIds((current) =>
                                            event.target.checked
                                              ? current.includes(student.id)
                                                ? current
                                                : [...current, student.id]
                                              : current.filter(
                                                  (id) => id !== student.id,
                                                ),
                                          );
                                        }}
                                      />

                                      <span className="reviewer-student-check-copy">
                                        <strong>{student.display_name}</strong>
                                        <small>
                                          {student.student_number
                                            ? `${student.student_number} · `
                                            : ''}
                                          {student.email}
                                        </small>
                                      </span>
                                    </label>
                                  );
                                })
                              ) : (
                                <div className="reviewer-student-empty">
                                  {selectedSubjects.length
                                    ? 'No students found.'
                                    : 'Select a subject first.'}
                                </div>
                              )}
                            </div>

                            {assignmentMode === 'selected' && (
                              <div className="reviewer-assign-dropdown-footer">
                                <span>
                                  {assignedStudentIds.length} student
                                  {assignedStudentIds.length === 1
                                    ? ''
                                    : 's'}{' '}
                                  selected
                                </span>

                                <button
                                  type="button"
                                  disabled={!assignedStudentIds.length}
                                  onClick={() =>
                                    setStudentPickerOpen(false)
                                  }
                                >
                                  Done
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <small className="reviewer-cosmetic-note">
                        Selected students must still be actively enrolled
                        in at least one of this reviewer&apos;s subjects.
                      </small>
                    </div>

                    <label>
                      Due
                      <input
                        type="datetime-local"
                        value={cosmeticRules.dueAt}
                        onChange={(event) =>
                          setCosmeticRules((current) => ({
                            ...current,
                            dueAt: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <div className="reviewer-canvas-date-grid">
                      <label>
                        Available from
                        <input
                          type="datetime-local"
                          value={cosmeticRules.availableFrom}
                          onChange={(event) =>
                            setCosmeticRules((current) => ({
                              ...current,
                              availableFrom: event.target.value,
                            }))
                          }
                        />
                      </label>

                      <label>
                        Until
                        <input
                          type="datetime-local"
                          value={cosmeticRules.availableUntil}
                          onChange={(event) =>
                            setCosmeticRules((current) => ({
                              ...current,
                              availableUntil: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>

                    <small className="reviewer-cosmetic-note">
                     Available <strong>From / Until</strong> controls when students can access and take the reviewer. <strong>Due</strong> shows the expected completion deadline but does not automatically block access. Use <strong>Until</strong> if you want the reviewer to become unavailable after a specific date and time.
                    </small>
                  </div>
                </div>

                <div className="reviewer-canvas-setting-row">
                  <span>Notifications</span>

                  <div className="reviewer-canvas-options">
                    <label className="reviewer-canvas-inline-check">
                      <input
                        type="checkbox"
                        checked={cosmeticRules.notifyOnChange}
                        onChange={(event) =>
                          setCosmeticRules((current) => ({
                            ...current,
                            notifyOnChange: event.target.checked,
                          }))
                        }
                      />
                      <span>Notify students this reviewer has changed</span>
                    </label>

                    <small className="reviewer-cosmetic-note">
                      On Save / Save & Publish, only students included in this reviewer assignment receive an in-app notification.
                    </small>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <section className="reviewer-canvas-questions">
              <div className="reviewer-question-page-heading">
                <div>
                  <h2>Questions</h2>
                  <p>
                    Add individual questions or choose
                    existing questions from the selected
                    subject question bank.
                  </p>
                </div>

                <div className="reviewer-question-heading-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setQuestionImportSubjectId(
                        questionImportSubjectId || selectedSubjects[0] || '',
                      );
                      setQuestionImportOpen(true);
                    }}
                  >
                    Import Questions
                  </button>

                  <button
                    type="button"
                    onClick={beginNewQuestion}
                  >
                    + New Question
                  </button>
                </div>
              </div>

              {!selectedSubjects.length ? (
                <div className="reviewer-empty-state">
                  <strong>
                    Select a subject first
                  </strong>
                  <p>
                    Go to Details and choose at least one
                    subject before adding questions.
                  </p>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setTab('details')}
                  >
                    Go to Details
                  </button>
                </div>
              ) : (
                <>
                  {questionImportOpen && (
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label="Import Questions"
                      onMouseDown={(event) => {
                        if (event.target === event.currentTarget) {
                          setQuestionImportOpen(false);
                        }
                      }}
                      style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 10000,
                        background: 'rgba(35, 24, 39, 0.46)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 18,
                        overflowY: 'auto',
                      }}
                    >
                      <div
                        className="reviewer-question-import-panel"
                        style={{
                          width: 'min(760px, 100%)',
                          maxHeight: 'calc(100vh - 36px)',
                          overflowY: 'auto',
                          background: '#fff',
                          borderRadius: 18,
                          padding: 20,
                          boxShadow: '0 24px 70px rgba(35, 24, 39, 0.24)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            marginBottom: 14,
                          }}
                        >
                          <div>
                            <h3 style={{ margin: 0 }}>Import Questions</h3>
                            <p style={{ margin: '4px 0 0' }}>
                              Upload the completed Excel / Google Sheets or Word question template.
                            </p>
                          </div>

                          <button
                            type="button"
                            className="ghost"
                            aria-label="Close Import Questions"
                            onClick={() => setQuestionImportOpen(false)}
                            style={{ flexShrink: 0 }}
                          >
                            ×
                          </button>
                        </div>

                      {selectedSubjects.length > 1 && (
                        <label className="reviewer-question-import-subject">
                          Import into subject
                          <select
                            value={
                              questionImportSubjectId ||
                              selectedSubjects[0] ||
                              ''
                            }
                            onChange={(event) =>
                              setQuestionImportSubjectId(event.target.value)
                            }
                          >
                            {selectedSubjects.map((subjectId) => {
                              const subject = subjectMap.get(subjectId);

                              return (
                                <option key={subjectId} value={subjectId}>
                                  {subject?.name || 'Subject'}
                                  {subject?.code ? ` — ${subject.code}` : ''}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                      )}

                      <ImportPanel
                        kind="questions"
                        questionSubjectId={
                          questionImportSubjectId ||
                          selectedSubjects[0]
                        }
                        onDone={(importedQuestions) => {
                          setQuestionImportOpen(false);
                          setQuestionVersion((value) => value + 1);

                          if (
                            draft.settings.selection === 'fixed' &&
                            importedQuestions?.length
                          ) {
                            setSelected((current) => {
                              const existing = new Set(
                                current.map((question) => question.id),
                              );

                              return [
                                ...current,
                                ...importedQuestions.filter(
                                  (question) => !existing.has(question.id),
                                ),
                              ];
                            });
                          }

                          setMessage(
                            importedQuestions?.length
                              ? `${importedQuestions.length} imported question${
                                  importedQuestions.length === 1 ? '' : 's'
                                } added successfully.`
                              : 'Questions imported successfully.',
                          );
                        }}
                      />
                      </div>
                    </div>
                  )}

                  {editingQuestion && !editingQuestion.id && (
                    <QuestionEditor
                      row={editingQuestion}
                      subjects={selectedSubjects}
                      subjectMap={subjectMap}
                      accepted={accepted}
                      busy={busy}
                      onAcceptedChange={setAccepted}
                      onRowChange={setEditingQuestion}
                      onFieldChange={questionField}
                      onCancel={() => {
                        setEditingQuestion(null);
                        setAccepted('');
                      }}
                      onSave={saveQuestion}
                      onMessage={setMessage}
                    />
                  )}

                  {draft.settings.selection ===
                  'random' ? (
                    <div className="reviewer-random-panel">
                      <div>
                        <span>
                          Available question pool
                        </span>
                        <strong>
                          {randomPoolCount}
                        </strong>
                      </div>

                      <div>
                        <span>
                          Questions per attempt
                        </span>
                        <strong>
                          {draft.settings.count || 0}
                        </strong>
                      </div>

                      <p>
                        Every active question from the
                        selected subjects is eligible.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="reviewer-question-bank-panel reviewer-compact-question-panel">
                        <div className="reviewer-question-bank-toolbar reviewer-compact-toolbar">
                          <div>
                            <h3>Add from Question Bank</h3>
                            <p>
                              {selected.length} selected for this reviewer ·{' '}
                              {randomPoolCount} active in selected subject(s)
                            </p>

                            <div className="reviewer-bank-bulk-actions">
                              <button
                                type="button"
                                className="ghost"
                                disabled={!questionRows.length}
                                onClick={() =>
                                  setSelected((current) => {
                                    const existing = new Map(
                                      current.map((item) => [item.id, item]),
                                    );

                                    for (const question of questionRows) {
                                      existing.set(question.id, question);
                                    }

                                    return Array.from(existing.values());
                                  })
                                }
                              >
                                Select all
                              </button>

                              <button
                                type="button"
                                className="ghost"
                                disabled={!selected.length}
                                onClick={() => setSelected([])}
                              >
                                Clear
                              </button>
                            </div>
                          </div>

                          <input
                            type="search"
                            placeholder="Search questions"
                            value={questionSearch}
                            onChange={(event) =>
                              setQuestionSearch(event.target.value)
                            }
                          />
                        </div>

                        <div className="reviewer-compact-question-list">
                          {questionRows.map((question) => {
                            const checked = selected.some(
                              (item) => item.id === question.id,
                            );
                            return (
                              <div
                                key={question.id}
                                className={`reviewer-bank-row-clean ${
                                  checked ? 'selected' : ''
                                }`}
                              >
                                <label className="reviewer-bank-row-select">
                                  <input
                                    aria-label={`Select ${question.text}`}
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) =>
                                      setSelected(
                                        event.target.checked
                                          ? [...selected, question]
                                          : selected.filter(
                                              (item) => item.id !== question.id,
                                            ),
                                      )
                                    }
                                  />

                                  <span>{question.text}</span>
                                </label>

                                <span
                                  role="button"
                                  tabIndex={0}
                                  className="reviewer-bank-row-delete"
                                  title="Delete from Question Bank"
                                  aria-label={`Delete ${question.text}`}
                                  onClick={() => void deleteBankQuestion(question)}
                                  onKeyDown={(event) => {
                                    if (
                                      event.key === 'Enter' ||
                                      event.key === ' '
                                    ) {
                                      event.preventDefault();
                                      void deleteBankQuestion(question);
                                    }
                                  }}
                                >
                                  −
                                </span>
                              </div>
                            );
                          })}

                          {!questionRows.length && (
                            <div className="reviewer-empty-state reviewer-compact-empty">
                              No active questions match this search.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="reviewer-question-count-summary">
                        <strong>
                          {draft.settings.selection === 'fixed'
                            ? `${selected.length} question${
                                selected.length === 1 ? '' : 's'
                              } will appear in each attempt.`
                            : `${draft.settings.count} randomized question${
                                draft.settings.count === 1 ? '' : 's'
                              } will appear per attempt from ${randomPoolCount} active questions.`}
                        </strong>
                      </div>

                      <div className="reviewer-selected-section reviewer-compact-selected-section">
                        <div className="reviewer-selected-heading reviewer-compact-selected-heading">
                          <div>
                            <h3>Reviewer Questions</h3>
                            <span>{selected.length}</span>
                          </div>

                          {!!selected.length && (
                            <input
                              type="search"
                              placeholder="Search selected questions"
                              value={selectedQuestionSearch}
                              onChange={(event) =>
                                setSelectedQuestionSearch(event.target.value)
                              }
                            />
                          )}
                        </div>

                        {!selected.length ? (
                          <div className="reviewer-empty-state reviewer-compact-empty">
                            <strong>No questions added yet</strong>
                            <p>
                              Create a new question or choose one from the
                              question bank above.
                            </p>
                          </div>
                        ) : (
                          <div className="reviewer-compact-question-list reviewer-selected-compact-list">
                            {filteredSelectedQuestions.map((question) => {
                              const originalIndex = selected.findIndex(
                                (item) => item.id === question.id,
                              );
                              const expanded =
                                expandedSelectedQuestion === question.id;

                              return (
                                <div
                                  className="reviewer-compact-question-item reviewer-selected-compact-item"
                                  key={question.id}
                                >
                                  <div className="reviewer-selected-compact-row">
                                    <span className="reviewer-question-index">
                                      {originalIndex + 1}
                                    </span>

                                    <div
                                      role="button"
                                      tabIndex={0}
                                      className="reviewer-question-expand-trigger"
                                      onClick={() => {
                                        setExpandedSelectedQuestion(
                                          expanded ? null : question.id,
                                        );
                                        void openQuestionEditor(question.id);
                                      }}
                                      onKeyDown={(event) => {
                                        if (
                                          event.key === 'Enter' ||
                                          event.key === ' '
                                        ) {
                                          event.preventDefault();
                                          setExpandedSelectedQuestion(
                                            expanded ? null : question.id,
                                          );
                                          void openQuestionEditor(question.id);
                                        }
                                      }}
                                    >
                                      <span>{question.text}</span>
                                      <b aria-hidden="true">
                                        {expanded ? '−' : '+'}
                                      </b>
                                    </div>

                                    <div className="reviewer-selected-compact-actions">
                                      <button
                                        type="button"
                                        className="ghost"
                                        title="Move up"
                                        disabled={originalIndex === 0}
                                        onClick={() => {
                                          const next = [...selected];
                                          [next[originalIndex - 1], next[originalIndex]] = [
                                            next[originalIndex],
                                            next[originalIndex - 1],
                                          ];
                                          setSelected(next);
                                        }}
                                      >
                                        ↑
                                      </button>

                                      <button
                                        type="button"
                                        className="ghost"
                                        title="Move down"
                                        disabled={originalIndex === selected.length - 1}
                                        onClick={() => {
                                          const next = [...selected];
                                          [next[originalIndex + 1], next[originalIndex]] = [
                                            next[originalIndex],
                                            next[originalIndex + 1],
                                          ];
                                          setSelected(next);
                                        }}
                                      >
                                        ↓
                                      </button>

                                      <button
                                        type="button"
                                        className="ghost"
                                        onClick={() =>
                                          setSelected(
                                            selected.filter(
                                              (item) => item.id !== question.id,
                                            ),
                                          )
                                        }
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>

                                  {expanded &&
                                    editingQuestion?.id === question.id && (
                                      <div className="reviewer-question-expanded reviewer-selected-question-expanded reviewer-inline-question-editor">
                                        <QuestionEditor
                                          row={editingQuestion}
                                          subjects={selectedSubjects}
                                          subjectMap={subjectMap}
                                          accepted={accepted}
                                          busy={busy}
                                          onAcceptedChange={setAccepted}
                                          onRowChange={setEditingQuestion}
                                          onFieldChange={questionField}
                                          onCancel={() => {
                                            setEditingQuestion(null);
                                            setAccepted('');
                                            setExpandedSelectedQuestion(null);
                                          }}
                                          onSave={saveQuestion}
                                          onMessage={setMessage}
                                        />
                                      </div>
                                    )}
                                </div>
                              );
                            })}

                            {!filteredSelectedQuestions.length && (
                              <div className="reviewer-empty-state reviewer-compact-empty">
                                No selected questions match this search.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        <footer className="reviewer-save-bar">
          <div className="reviewer-save-summary">
            <span>
              {selectedSubjects.length} subject
              {selectedSubjects.length === 1
                ? ''
                : 's'}
            </span>
            <span>•</span>
            <span>
              {draft.settings.selection === 'fixed'
                ? `${selected.length} question${
                    selected.length === 1
                      ? ''
                      : 's'
                  }`
                : `${
                    draft.settings.count || 0
                  } random questions per attempt`}
            </span>
          </div>

          <div className="reviewer-save-actions">
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={backToReviewers}
            >
              Cancel
            </button>

            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() =>
                saveReviewer(false)
              }
            >
              {busy ? 'Saving…' : 'Save'}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                saveReviewer(true)
              }
            >
              {busy
                ? 'Saving…'
                : 'Save & Publish'}
            </button>
          </div>
        </footer>
        {resetAttemptsOpen && (
          <div
            className="reviewer-reset-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setResetAttemptsOpen(false);
              }
            }}
          >
            <section
              className="reviewer-reset-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="reset-attempts-title"
            >
              <header className="reviewer-reset-modal-header">
                <div>
                  <h2 id="reset-attempts-title">
                    Reset / Restart Attempts
                  </h2>
                  <p>
                    Let a student take this reviewer again from Attempt 1.
                  </p>
                </div>

                <button
                  type="button"
                  className="ghost reviewer-reset-modal-close"
                  aria-label="Close reset attempts"
                  onClick={() => setResetAttemptsOpen(false)}
                >
                  ×
                </button>
              </header>

              <div className="reviewer-reset-modal-body">
                {!resetStudents.length ? (
                  <div className="reviewer-reset-empty">
                    No student attempts have been recorded for this reviewer
                    yet.
                  </div>
                ) : (
                  <>
                    <div className="reviewer-reset-mode-row">
                      <label>
                        <input
                          type="radio"
                          name="reset-attempt-mode"
                          checked={resetAttemptsMode === 'student'}
                          onChange={() =>
                            setResetAttemptsMode('student')
                          }
                        />
                        <span>One student</span>
                      </label>

                      <label>
                        <input
                          type="radio"
                          name="reset-attempt-mode"
                          checked={resetAttemptsMode === 'all'}
                          onChange={() =>
                            setResetAttemptsMode('all')
                          }
                        />
                        <span>All students</span>
                      </label>
                    </div>

                    {resetAttemptsMode === 'student' ? (
                      <>
                        <input
                          className="reviewer-reset-search"
                          type="search"
                          placeholder="Search name, email, or student number"
                          value={resetStudentSearch}
                          onChange={(event) =>
                            setResetStudentSearch(event.target.value)
                          }
                        />

                        <div className="reviewer-reset-student-list">
                          {filteredResetStudents.length ? (
                            filteredResetStudents.map((student) => (
                              <label
                                key={student.id}
                                className={`reviewer-reset-student-row ${
                                  resetStudentId === student.id
                                    ? 'is-selected'
                                    : ''
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="reset-student"
                                  checked={
                                    resetStudentId === student.id
                                  }
                                  onChange={() =>
                                    setResetStudentId(student.id)
                                  }
                                />

                                <span>
                                  <strong>{student.display_name}</strong>
                                  <small>
                                    {student.student_number
                                      ? `${student.student_number} · `
                                      : ''}
                                    {student.email}
                                  </small>
                                </span>

                                <em>
                                  {student.attempt_count} attempt
                                  {student.attempt_count === 1
                                    ? ''
                                    : 's'}
                                </em>
                              </label>
                            ))
                          ) : (
                            <div className="reviewer-reset-empty">
                              No matching student found.
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="reviewer-reset-warning">
                        <strong>
                          Reset all {resetStudents.length} student
                          {resetStudents.length === 1 ? '' : 's'}?
                        </strong>
                        <span>
                          All attempts, answers, scores, and grading records
                          for this reviewer will be removed.
                        </span>
                      </div>
                    )}

                    <div className="reviewer-reset-note">
                      <strong>This cannot be undone.</strong>
                      <span>
                        Editing the reviewer does not automatically reset
                        previous attempts. Use this only when you want the
                        student to restart.
                      </span>
                    </div>
                  </>
                )}
              </div>

              <footer className="reviewer-reset-modal-footer">
                <button
                  type="button"
                  className="ghost"
                  disabled={resetAttemptsBusy}
                  onClick={() => setResetAttemptsOpen(false)}
                >
                  Cancel
                </button>

                {!!resetStudents.length && (
                  <button
                    type="button"
                    disabled={
                      resetAttemptsBusy ||
                      (
                        resetAttemptsMode === 'student' &&
                        !resetStudentId
                      )
                    }
                    onClick={() => void confirmResetAttempts()}
                  >
                    {resetAttemptsBusy
                      ? 'Resetting…'
                      : resetAttemptsMode === 'all'
                        ? 'Reset All Attempts'
                        : 'Reset Student Attempts'}
                  </button>
                )}
              </footer>
            </section>
          </div>
        )}

      </div>
    </main>
  );
}

function QuestionEditor({
  row,
  subjects,
  subjectMap,
  accepted,
  busy,
  onAcceptedChange,
  onRowChange,
  onFieldChange,
  onCancel,
  onSave,
  onMessage,
}: {
  row: QuestionRow;
  subjects: string[];
  subjectMap: Map<string, SubjectOption>;
  accepted: string;
  busy: boolean;
  onAcceptedChange: (value: string) => void;
  onRowChange: (value: QuestionRow) => void;
  onFieldChange: <K extends keyof QuestionDataWithExplanation>(
    key: K,
    value: QuestionDataWithExplanation[K],
  ) => void;
  onCancel: () => void;
  onSave: () => Promise<void>;
  onMessage: (value: string) => void;
}) {
  return (
    <div className="reviewer-new-question-card">
      <div className="reviewer-new-question-header">
        <div>
          <span>NEW QUESTION</span>
          <h3>
            {row.id ? 'Edit Question' : 'Create Question'}
          </h3>
        </div>

        <button
          type="button"
          className="ghost"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>

      {subjects.length > 1 && (
        <div className="reviewer-question-meta-row">
          <label>
            Subject
            <select
              value={row.subject_id}
              onChange={(event) =>
                onRowChange({
                  ...row,
                  subject_id:
                    event.target.value,
                })
              }
            >
              {subjects.map((subjectId) => {
                const subject =
                  subjectMap.get(subjectId);

                return (
                  <option
                    key={subjectId}
                    value={subjectId}
                  >
                    {subject?.name || 'Subject'}
                    {subject?.code
                      ? ` — ${subject.code}`
                      : ''}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
      )}

      <div className="reviewer-question-meta-row reviewer-question-meta-row-compact">
        <label>
          Question type
          <select
            value={row.data.type}
            onChange={(event) => {
              onFieldChange(
                'type',
                event.target.value as QuestionType,
              );
              onFieldChange('correct', []);
              onAcceptedChange('');
            }}
          >
            {[
              'mc_single',
              'mc_multi',
              'fill_blank',
              'multi_blank',
              'short_answer',
              'long_answer',
            ].map((item) => (
              <option
                key={item}
                value={item}
              >
                {typeLabel(item as QuestionType)}
              </option>
            ))}
          </select>
        </label>

        <label className="reviewer-question-upload-field">
          Upload
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];

              if (!file) return;

              try {
                onFieldChange(
                  'image_path',
                  await uploadImage(file),
                );
              } catch (error) {
                onMessage(reviewerErrorText(error));
              }
            }}
          />
        </label>

        <label>
          Points
          <input
            type="number"
            min="0.01"
            max="10000"
            step="0.01"
            required
            value={row.data.points}
            onChange={(event) =>
              onFieldChange(
                'points',
                Number(event.target.value),
              )
            }
          />
        </label>
      </div>

      {row.data.image_path && (
        <div className="reviewer-question-image-inline">
          <ImageAttachment path={row.data.image_path} />
          <button
            type="button"
            className="ghost"
            onClick={() =>
              onFieldChange('image_path', null)
            }
          >
            Remove image
          </button>
        </div>
      )}

      <label className="reviewer-question-text-field">
        Question
        <textarea
          rows={5}
          maxLength={20000}
          required
          value={row.data.text}
          onChange={(event) =>
            onFieldChange(
              'text',
              event.target.value,
            )
          }
        />
      </label>

      <label className="reviewer-question-explanation-field">
        Explanation
        <textarea
          rows={3}
          maxLength={5000}
          placeholder="Optional explanation shown after the answer is checked, e.g. why the correct answer is correct."
          value={row.data.explanation || ''}
          onChange={(event) =>
            onFieldChange(
              'explanation',
              event.target.value,
            )
          }
        />
      </label>

      {row.data.type.startsWith('mc_') ? (
        <div className="reviewer-choice-builder">
          <div>
            <h4>
              Answers
            </h4>
            <p>
              Mark the correct choice
              {row.data.type === 'mc_multi'
                ? 's'
                : ''}.
            </p>
          </div>

          {row.data.choices.map(
            (choice, index) => (
              <div
                key={choice.id}
                className="reviewer-choice-row"
              >
                <input
                  aria-label={`Choice ${
                    index + 1
                  } is correct`}
                  type={
                    row.data.type ===
                    'mc_single'
                      ? 'radio'
                      : 'checkbox'
                  }
                  name="correct"
                  checked={row.data.correct.includes(
                    choice.id,
                  )}
                  onChange={(event) =>
                    onFieldChange(
                      'correct',
                      row.data.type ===
                        'mc_single'
                        ? [choice.id]
                        : event.target.checked
                          ? [
                              ...row.data
                                .correct,
                              choice.id,
                            ]
                          : row.data.correct.filter(
                              (id) =>
                                id !==
                                choice.id,
                            ),
                    )
                  }
                />

                <input
                  aria-label={`Choice ${
                    index + 1
                  } text`}
                  required
                  placeholder={`Answer ${
                    index + 1
                  }`}
                  value={choice.text}
                  onChange={(event) =>
                    onFieldChange(
                      'choices',
                      row.data.choices.map(
                        (
                          item,
                          itemIndex,
                        ) =>
                          itemIndex === index
                            ? {
                                ...item,
                                text:
                                  event
                                    .target
                                    .value,
                              }
                            : item,
                      ),
                    )
                  }
                />

                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    onFieldChange(
                      'choices',
                      row.data.choices.filter(
                        (item) =>
                          item.id !== choice.id,
                      ),
                    );

                    onFieldChange(
                      'correct',
                      row.data.correct.filter(
                        (id) =>
                          id !== choice.id,
                      ),
                    );
                  }}
                >
                  Remove
                </button>
              </div>
            ),
          )}

          <button
            type="button"
            className="ghost reviewer-add-choice"
            onClick={() =>
              onFieldChange('choices', [
                ...row.data.choices,
                {
                  id: crypto.randomUUID(),
                  text: '',
                },
              ])
            }
          >
            + Add another answer
          </button>
        </div>
      ) : row.data.type !== 'long_answer' ? (
        <div className="reviewer-answer-builder">
          <label>
            Accepted answers
            <textarea
              rows={4}
              value={accepted}
              onChange={(event) =>
                onAcceptedChange(
                  event.target.value,
                )
              }
              placeholder="One blank per line. Separate accepted variants with |"
            />
          </label>

          <p className="caption">
            One line per blank; separate accepted
            variants with |. Leave blank only for
            manually reviewed short answers.
          </p>

          <Check
            label="Strict text matching"
            checked={row.data.strict}
            onChange={(value) =>
              onFieldChange('strict', value)
            }
          />
        </div>
      ) : (
        <div className="notice">
          Paragraph responses are manually graded.
        </div>
      )}

      <div className="reviewer-question-footer">
        <button
          type="button"
          className="ghost"
          onClick={onCancel}
        >
          Cancel
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={onSave}
        >
          {busy
            ? 'Saving…'
            : 'Update Question'}
        </button>
      </div>
    </div>
  );
}

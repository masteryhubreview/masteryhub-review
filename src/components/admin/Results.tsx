'use client';

import { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/supabase';
import { download, makeCSV } from '@/lib/csv';
import * as XLSX from 'xlsx';
import { Notice, Pager, errorText } from '../shared';
import type { Branding } from '../Workspace';
import Quiz from '../Quiz';
import RemoteSelect from './RemoteSelect';

type Result = {
  id: string;
  reviewer_id: string;
  title: string;
  attempt_number: number;
  student_id: string;
  status: string;
  score: number;
  max_score: number;
  pending: number;
  started_at: string;
  submitted_at?: string | null;
  profiles: { display_name: string; email: string };
  subjects: { name: string };
};

export default function Results({
  branding,
}: {
  branding: Branding;
}) {
  const [rows, setRows] = useState<Result[]>([]);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [student, setStudent] = useState('');
  const [subject, setSubject] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionOnly, setActionOnly] = useState(false);

  function query(full = false) {
    let q = db()
      .from('official_attempt_results')
      .select(
        full
          ? '*,profiles(display_name,email),subjects(name)'
          : 'id,reviewer_id,title,attempt_number,student_id,status,score,max_score,pending,started_at,submitted_at,profiles(display_name,email),subjects(name)',
      );

    if (status) q = q.eq('status', status);
    if (student) q = q.eq('student_id', student);
    if (subject) q = q.eq('subject_id', subject);
    if (reviewer) q = q.eq('reviewer_id', reviewer);
    if (actionOnly) q = q.gt('pending', 0);

    return q;
  }

  useEffect(() => {
    let live = true;

    query()
      .order('started_at', { ascending: false })
      .range(page * 10, page * 10 + 9)
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        else if (live) setRows((data || []) as unknown as Result[]);
      });

    return () => {
      live = false;
    };
  }, [status, student, subject, reviewer, page, detail, actionOnly]);

  const latestRows = useMemo(() => rows, [rows]);

  async function exportData(full: boolean) {
    setBusy(true);

    try {
      const out: Record<string, unknown>[] = [];

      for (let p = 0; ; p++) {
        const { data, error } = await query(full)
          .order('id')
          .range(p * 250, p * 250 + 249);

        if (error) throw error;
        out.push(...((data || []) as unknown as Record<string, unknown>[]));
        if ((data || []).length < 250) break;
      }

      if (full) {
        const tables = [
          'profiles',
          'terms',
          'subjects',
          'enrollments',
          'questions',
          'reviewers',
          'reviewer_subjects',
          'reviewer_students',
          'reviewer_questions',
          'attempts',
          'grade_audit',
        ] as const;

        const workbook = XLSX.utils.book_new();

        const prettyHeader = (key: string) =>
          key
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (letter) => letter.toUpperCase());

        const looksLikeDateKey = (key: string) =>
          key.endsWith('_at') || key.endsWith('_date');

        const displayValue = (key: string, value: unknown) => {
          if (value === null || value === undefined) return '';

          if (looksLikeDateKey(key) && typeof value === 'string') {
            const date = new Date(value);
            if (!Number.isNaN(date.getTime())) return date.toLocaleString();
          }

          if (typeof value === 'boolean') return value ? 'Yes' : 'No';
          if (typeof value === 'object') return JSON.stringify(value, null, 2);
          return value;
        };

        const appendReadableSheet = (
          name: string,
          records: Record<string, unknown>[],
        ) => {
          if (!records.length) {
            const empty = XLSX.utils.aoa_to_sheet([
              [name],
              ['No records available.'],
            ]);
            empty['!cols'] = [{ wch: 42 }];
            XLSX.utils.book_append_sheet(workbook, empty, name.slice(0, 31));
            return;
          }

          const keys = Array.from(
            new Set(records.flatMap((record) => Object.keys(record))),
          );

          const rows = [
            keys.map(prettyHeader),
            ...records.map((record) =>
              keys.map((key) => displayValue(key, record[key])),
            ),
          ];

          const sheet = XLSX.utils.aoa_to_sheet(rows);

          if (sheet['!ref']) {
            const range = XLSX.utils.decode_range(sheet['!ref']);

            sheet['!autofilter'] = {
              ref: XLSX.utils.encode_range({
                s: { r: 0, c: range.s.c },
                e: { r: range.e.r, c: range.e.c },
              }),
            };

            sheet['!cols'] = keys.map((key, columnIndex) => {
              let width = Math.max(prettyHeader(key).length + 2, 12);

              for (
                let rowIndex = 1;
                rowIndex <= Math.min(range.e.r, 200);
                rowIndex++
              ) {
                const cell =
                  sheet[
                    XLSX.utils.encode_cell({
                      r: rowIndex,
                      c: columnIndex,
                    })
                  ];

                const longest = String(cell?.v ?? '')
                  .split('\n')
                  .reduce((max, line) => Math.max(max, line.length), 0);

                width = Math.max(width, Math.min(longest + 2, 40));
              }

              return { wch: width };
            });

            sheet['!rows'] = Array.from(
              { length: Math.min(range.e.r + 1, 501) },
              (_, rowIndex) => ({ hpt: rowIndex === 0 ? 24 : 20 }),
            );
          }

          XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
        };

        const tableData: Record<string, Record<string, unknown>[]> = {};

        for (const table of tables) {
          const records: Record<string, unknown>[] = [];

          for (let p = 0; ; p++) {
            const { data, error } = await db()
              .from(table)
              .select('*')
              .order('created_at', { ascending: true })
              .range(p * 500, p * 500 + 499);

            if (error) {
              const fallback = await db()
                .from(table)
                .select('*')
                .range(p * 500, p * 500 + 499);

              if (fallback.error) throw fallback.error;

              records.push(
                ...((fallback.data || []) as unknown as Record<
                  string,
                  unknown
                >[]),
              );

              if ((fallback.data || []).length < 500) break;
            } else {
              records.push(
                ...((data || []) as unknown as Record<string, unknown>[]),
              );

              if ((data || []).length < 500) break;
            }
          }

          tableData[table] = records;
        }

        const profiles = tableData.profiles || [];
        const terms = tableData.terms || [];
        const subjects = tableData.subjects || [];
        const enrollments = tableData.enrollments || [];
        const questions = tableData.questions || [];
        const reviewers = tableData.reviewers || [];
        const reviewerSubjects = tableData.reviewer_subjects || [];
        const reviewerStudents = tableData.reviewer_students || [];
        const reviewerQuestions = tableData.reviewer_questions || [];
        const attempts = tableData.attempts || [];
        const gradeAudit = tableData.grade_audit || [];

        const byId = (
          records: Record<string, unknown>[],
          id: unknown,
        ): Record<string, unknown> | undefined =>
          records.find((record) => String(record.id ?? '') === String(id ?? ''));

        const studentLabel = (id: unknown) => {
          const profile = byId(profiles, id);
          if (!profile) return String(id ?? '');
          const number = String(profile.student_number ?? '').trim();
          const name = String(profile.display_name ?? '').trim();
          return number ? `${name} (${number})` : name || String(id ?? '');
        };

        const subjectLabel = (id: unknown) => {
          const subject = byId(subjects, id);
          if (!subject) return String(id ?? '');
          const code = String(subject.code ?? '').trim();
          const name = String(subject.name ?? '').trim();
          return code ? `${name} (${code})` : name || String(id ?? '');
        };

        const termLabel = (id: unknown) =>
          String(byId(terms, id)?.name ?? id ?? '');

        const reviewerLabel = (id: unknown) =>
          String(byId(reviewers, id)?.title ?? id ?? '');

        const questionText = (id: unknown) => {
          const question = byId(questions, id);
          const data = question?.data;
          if (
            data &&
            typeof data === 'object' &&
            !Array.isArray(data) &&
            'text' in data
          ) {
            return String((data as Record<string, unknown>).text ?? '');
          }
          return String(id ?? '');
        };

        const questionType = (data: unknown) => {
          if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
          const type = String((data as Record<string, unknown>).type ?? '');
          const labels: Record<string, string> = {
            mc_single: 'Multiple Choice',
            mc_multi: 'Multiple Answers',
            fill_blank: 'Fill in the Blank',
            multi_blank: 'Multiple Blanks',
            short_answer: 'Short Answer',
            long_answer: 'Essay / Long Answer',
          };
          return labels[type] || type;
        };

        const questionField = (data: unknown, key: string) => {
          if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
          return (data as Record<string, unknown>)[key];
        };

        const readableChoices = (data: unknown) => {
          const value = questionField(data, 'choices');
          if (!Array.isArray(value)) return '';
          return value
            .map((choice, index) => {
              if (!choice || typeof choice !== 'object') return String(choice);
              const item = choice as Record<string, unknown>;
              const label = String.fromCharCode(65 + index);
              return `${label}. ${String(item.text ?? '')}`;
            })
            .join('\n');
        };

        const readableAnswers = (data: unknown) => {
          const correct = questionField(data, 'correct');
          const accepted = questionField(data, 'accepted');

          if (Array.isArray(correct) && correct.length) {
            return correct.join(', ');
          }

          if (Array.isArray(accepted) && accepted.length) {
            return accepted
              .map((group) =>
                Array.isArray(group) ? group.join(' | ') : String(group),
              )
              .join(' ; ');
          }

          return 'Manual grading';
        };

        const scoreText = (attempt: Record<string, unknown>) => {
          if (String(attempt.status ?? '') === 'in_progress') return 'Not submitted';
          return `${String(attempt.score ?? 0)} / ${String(attempt.max_score ?? 0)}`;
        };

        const studentsFriendly = profiles
          .filter((profile) => String(profile.role ?? '') === 'student')
          .map((profile) => ({
            student_name: profile.display_name,
            student_number: profile.student_number,
            email: profile.email,
            term: termLabel(profile.term_id),
            account_status: profile.is_active ? 'Active' : 'Inactive',
            created_at: profile.created_at,
          }));

        const enrollmentsFriendly = enrollments.map((enrollment) => ({
          student: studentLabel(enrollment.student_id),
          email: byId(profiles, enrollment.student_id)?.email ?? '',
          subject: subjectLabel(enrollment.subject_id),
          term: termLabel(enrollment.term_id),
          enrollment_status: enrollment.is_active ? 'Active' : 'Inactive',
          enrolled_at: enrollment.created_at,
        }));

        const questionsFriendly = questions.map((question) => ({
          subject: subjectLabel(question.subject_id),
          question_type: questionType(question.data),
          question: questionField(question.data, 'text'),
          choices: readableChoices(question.data),
          correct_or_accepted_answer: readableAnswers(question.data),
          points: questionField(question.data, 'points'),
          explanation: questionField(question.data, 'explanation'),
          strict_matching: questionField(question.data, 'strict') ? 'Yes' : 'No',
          status: question.is_active ? 'Active' : 'Inactive',
          created_at: question.created_at,
        }));

        const reviewersFriendly = reviewers.map((reviewer) => {
          const linkedSubjects = reviewerSubjects
            .filter(
              (link) =>
                String(link.reviewer_id ?? '') === String(reviewer.id ?? ''),
            )
            .map((link) => subjectLabel(link.subject_id));

          const fallbackSubject = reviewer.subject_id
            ? [subjectLabel(reviewer.subject_id)]
            : [];

          const assignedStudents = reviewerStudents.filter(
            (link) =>
              String(link.reviewer_id ?? '') === String(reviewer.id ?? ''),
          ).length;

          const linkedQuestions = reviewerQuestions.filter(
            (link) =>
              String(link.reviewer_id ?? '') === String(reviewer.id ?? ''),
          ).length;

          return {
            reviewer: reviewer.title,
            description: reviewer.description,
            subjects: [...new Set([...linkedSubjects, ...fallbackSubject])].join(
              ', ',
            ),
            published: reviewer.published ? 'Yes' : 'No',
            question_count: linkedQuestions,
            individually_assigned_students: assignedStudents,
            created_at: reviewer.created_at,
          };
        });

        const assignmentsFriendly = reviewerStudents.map((assignment) => ({
          reviewer: reviewerLabel(assignment.reviewer_id),
          student: studentLabel(assignment.student_id),
          email: byId(profiles, assignment.student_id)?.email ?? '',
          subject: assignment.subject_id
            ? subjectLabel(assignment.subject_id)
            : '',
          assigned_at: assignment.created_at,
        }));

        const attemptsFriendly = attempts.map((attempt) => ({
          student: studentLabel(attempt.student_id),
          email: byId(profiles, attempt.student_id)?.email ?? '',
          reviewer: reviewerLabel(attempt.reviewer_id) || attempt.title,
          subject: subjectLabel(attempt.subject_id),
          attempt_number: attempt.attempt_number,
          status: String(attempt.status ?? '').replaceAll('_', ' '),
          result: scoreText(attempt),
          pending_manual_answers: attempt.pending,
          started_at: attempt.started_at,
          submitted_at: attempt.submitted_at,
        }));

        const gradingFriendly = gradeAudit.map((audit) => {
          const attempt = byId(attempts, audit.attempt_id);
          const admin = byId(profiles, audit.admin_id);
          const newGrade =
            audit.new_grade &&
            typeof audit.new_grade === 'object' &&
            !Array.isArray(audit.new_grade)
              ? (audit.new_grade as Record<string, unknown>)
              : {};

          return {
            student: attempt ? studentLabel(attempt.student_id) : '',
            reviewer: attempt ? reviewerLabel(attempt.reviewer_id) : '',
            attempt_number: attempt?.attempt_number ?? '',
            question: questionText(audit.question_id),
            points_awarded: newGrade.awarded ?? '',
            notes: newGrade.notes ?? '',
            graded_by: admin?.display_name ?? admin?.email ?? '',
            graded_at: audit.created_at,
          };
        });

        const backupInfo = XLSX.utils.aoa_to_sheet([
          ['MASTERYHUB — FULL SYSTEM BACKUP'],
          ['Readable administrative backup'],
          [],
          ['Exported', new Date().toLocaleString()],
          ['Purpose', 'Client-friendly backup and administrative reference'],
          [
            'Note',
            'The first sheets use names and labels instead of database IDs. Technical source data is retained in the Technical Data sheets at the end of this workbook.',
          ],
          [],
          ['QUICK SUMMARY'],
          ['Students', studentsFriendly.length],
          ['Subjects', subjects.length],
          ['Enrollments', enrollments.length],
          ['Questions', questions.length],
          ['Reviewers', reviewers.length],
          ['Attempts', attempts.length],
          ['Manual grading records', gradeAudit.length],
          [],
          ['READABLE SHEETS'],
          ['Students', 'Student names, numbers, emails, term and account status'],
          ['Enrollments', 'Who is enrolled in which subject and term'],
          ['Questions', 'Readable question bank with choices and answers'],
          ['Reviewers', 'Reviewer names, subjects, publication and counts'],
          ['Assignments', 'Reviewer-to-student assignments'],
          ['Results & Attempts', 'All attempts with names, reviewer, score and status'],
          ['Manual Grading', 'Manual grading records with student and question details'],
          [],
          ['TECHNICAL DATA'],
          [
            'Technical sheets',
            'Original database records are retained for troubleshooting/recovery reference.',
          ],
        ]);
        backupInfo['!cols'] = [{ wch: 28 }, { wch: 82 }];
        backupInfo['!rows'] = [{ hpt: 30 }, { hpt: 22 }];
        XLSX.utils.book_append_sheet(workbook, backupInfo, 'Backup Summary');

        appendReadableSheet('Students', studentsFriendly);
        appendReadableSheet('Enrollments', enrollmentsFriendly);
        appendReadableSheet('Questions', questionsFriendly);
        appendReadableSheet('Reviewers', reviewersFriendly);
        appendReadableSheet('Assignments', assignmentsFriendly);
        appendReadableSheet('Results & Attempts', attemptsFriendly);
        appendReadableSheet('Manual Grading', gradingFriendly);

        // Preserve the complete source records after the readable client-facing sheets.
        for (const table of tables) {
          const technicalName = `Tech ${table
            .split('_')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')}`;

          appendReadableSheet(technicalName, tableData[table] || []);
        }

        const binary = XLSX.write(workbook, {
          bookType: 'xlsx',
          type: 'array',
        });

        const blob = new Blob([binary], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `masteryhub-full-backup-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);

        setMessage('Full Excel backup downloaded. No records were deleted.');
      } else {
        download('results.csv', makeCSV(out));
        setMessage(`${out.length} attempts exported. No records were deleted.`);
      }
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (detail) {
    return (
      <Quiz
        admin
        id={detail}
        logoPath={branding.logo_path}
        onClose={() => setDetail(null)}
      />
    );
  }

  const pendingCount = latestRows.filter(
    (row) => row.pending > 0 || row.status === 'pending_review',
  ).length;
  const gradedCount = latestRows.filter((row) => row.status === 'graded').length;
  return (
    <div className="admin-standard-page">
      <div className="page-heading admin-page-heading">
        <div>
          <span className="eyebrow">LEARNING IN VIEW</span>
          <h1>Results & grading</h1>
          <p>
            Latest attempts are shown first. Open Needs Review to grade answers
            that require admin checking.
          </p>
        </div>

        <div className="actions admin-page-actions">
          <button
            className="ghost"
            disabled={busy}
            onClick={() => exportData(false)}
          >
            Export results CSV
          </button>
          <button disabled={busy} onClick={() => exportData(true)}>
            Download Full Backup
          </button>
        </div>
      </div>

      <Notice message={message} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <div className="panel" style={{ padding: '12px 14px', minHeight: 0 }}>
          <small>Needs Review</small>
          <strong style={{ display: 'block', marginTop: 4, fontSize: 18 }}>
            {pendingCount}
          </strong>
        </div>
        <div className="panel" style={{ padding: '12px 14px', minHeight: 0 }}>
          <small>Graded</small>
          <strong style={{ display: 'block', marginTop: 4, fontSize: 18 }}>
            {gradedCount}
          </strong>
        </div>
      </div>

      <div className="filter-grid admin-compact-filters">
        <label>
          View
          <select
            value={actionOnly ? 'needs_review' : status}
            onChange={(e) => {
              const value = e.target.value;
              setActionOnly(value === 'needs_review');
              setStatus(value === 'needs_review' ? '' : value);
              setPage(0);
            }}
          >
            <option value="">Latest results</option>
            <option value="needs_review">Needs review</option>
            <option value="pending_review">Pending review</option>
            <option value="graded">Graded</option>
          </select>
        </label>

        <RemoteSelect
          table="profiles"
          studentsOnly
          label="Student"
          value={student}
          onChange={(value) => {
            setStudent(value);
            setPage(0);
          }}
        />

        <RemoteSelect
          table="subjects"
          label="Subject"
          value={subject}
          onChange={(value) => {
            setSubject(value);
            setReviewer('');
            setPage(0);
          }}
        />

        <RemoteSelect
          table="reviewers"
          label="Reviewer"
          subject={subject}
          value={reviewer}
          onChange={(value) => {
            setReviewer(value);
            setPage(0);
          }}
        />
      </div>

      <div className="panel table-wrap admin-compact-table">
        <table style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '34%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Student</th>
              <th>Reviewer</th>
              <th>Latest Attempt</th>
              <th>Status</th>
              <th>Result</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {latestRows.map((row) => {
              const needsReview =
                row.pending > 0 || row.status === 'pending_review';

              return (
                <tr className="admin-record-row" key={row.id}>
                  <td>
                    {row.profiles?.display_name}
                    <small
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        paddingRight: 16,
                      }}
                      title={row.profiles?.email}
                    >
                      {row.profiles?.email}
                    </small>
                  </td>

                  <td>
                    {row.title}
                    <small>{row.subjects?.name}</small>
                  </td>

                  <td>Attempt {row.attempt_number}</td>

                  <td>
                    <span className="pill">
                      {needsReview
                        ? 'Needs review'
                        : row.status.replaceAll('_', ' ')}
                    </span>
                  </td>

                  <td>
                    {row.status === 'in_progress'
                      ? 'Not submitted'
                      : needsReview
                        ? `${row.pending} answer${row.pending === 1 ? '' : 's'} to check`
                        : `${row.score} / ${row.max_score}`}
                  </td>

                  <td>
                    <button
                      className={needsReview ? '' : 'ghost'}
                      onClick={() => setDetail(row.id)}
                    >
                      {needsReview
                        ? 'Review answers'
                        : row.status === 'in_progress'
                          ? 'View attempt'
                          : 'View result'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!latestRows.length && (
          <div className="empty">
            {actionOnly
              ? 'No answers are waiting for admin review.'
              : 'No attempts match these filters.'}
          </div>
        )}
      </div>

      <div className="admin-standard-pager">
        <Pager page={page} setPage={setPage} more={rows.length === 10} />
      </div>
    </div>
  );
}

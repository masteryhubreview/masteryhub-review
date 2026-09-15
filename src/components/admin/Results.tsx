'use client';

import { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/supabase';
import { download, makeCSV } from '@/lib/csv';
import * as XLSX from 'xlsx';
import { Notice, Pager, errorText } from '../shared';
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

export default function Results() {
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
      .from('attempts')
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

  const latestRows = useMemo(() => {
    const byStudentReviewer = new Map<string, Result>();

    for (const row of rows) {
      const key = `${row.student_id}:${row.reviewer_id}`;
      const current = byStudentReviewer.get(key);

      if (
        !current ||
        row.attempt_number > current.attempt_number ||
        (row.attempt_number === current.attempt_number &&
          new Date(row.started_at).getTime() > new Date(current.started_at).getTime())
      ) {
        byStudentReviewer.set(key, row);
      }
    }

    return Array.from(byStudentReviewer.values());
  }, [rows]);

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

        const normalize = (value: unknown) => {
          if (value === null || value === undefined) return '';
          if (typeof value === 'object') return JSON.stringify(value);
          return value;
        };

        const appendSheet = (
          name: string,
          records: Record<string, unknown>[],
        ) => {
          const normalized = records.map((record) =>
            Object.fromEntries(
              Object.entries(record).map(([key, value]) => [
                key,
                normalize(value),
              ]),
            ),
          );

          const sheet = XLSX.utils.json_to_sheet(
            normalized.length ? normalized : [{ info: 'No records' }],
          );

          if (sheet['!ref']) {
            const range = XLSX.utils.decode_range(sheet['!ref']);
            sheet['!cols'] = Array.from(
              { length: range.e.c - range.s.c + 1 },
              (_, columnIndex) => {
                let width = 12;
                for (
                  let rowIndex = range.s.r;
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
                  width = Math.max(
                    width,
                    Math.min(String(cell?.v ?? '').length + 2, 45),
                  );
                }
                return { wch: width };
              },
            );
          }

          XLSX.utils.book_append_sheet(
            workbook,
            sheet,
            name.slice(0, 31),
          );
        };

        appendSheet('Backup Info', [
          {
            exported_at: new Date().toISOString(),
            format: 'MasteryHub full system backup',
            note: 'Keep this file in a secure location.',
          },
        ]);

        for (const table of tables) {
          const records: Record<string, unknown>[] = [];

          for (let p = 0; ; p++) {
            const { data, error } = await db()
              .from(table)
              .select('*')
              .order('created_at', { ascending: true })
              .range(p * 500, p * 500 + 499);

            if (error) {
              // Some link tables do not have created_at.
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

          appendSheet(
            table
              .split('_')
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(' '),
            records,
          );
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
    return <Quiz admin id={detail} onClose={() => setDetail(null)} />;
  }

  const pendingCount = latestRows.filter(
    (row) => row.pending > 0 || row.status === 'pending_review',
  ).length;
  const gradedCount = latestRows.filter((row) => row.status === 'graded').length;
  const inProgressCount = latestRows.filter(
    (row) => row.status === 'in_progress',
  ).length;

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
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
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
        <div className="panel" style={{ padding: '12px 14px', minHeight: 0 }}>
          <small>In Progress</small>
          <strong style={{ display: 'block', marginTop: 4, fontSize: 18 }}>
            {inProgressCount}
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
            <option value="in_progress">In progress</option>
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

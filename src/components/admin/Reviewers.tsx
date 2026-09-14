'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db, rpc } from '@/lib/supabase';
import type { Reviewer } from '@/lib/types';
import { Notice, Pager } from '../shared';

type SubjectOption = {
  id: string;
  name: string;
  code: string;
};

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

export default function Reviewers() {
  const router = useRouter();

  const [rows, setRows] = useState<Reviewer[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [reviewerSubjects, setReviewerSubjects] = useState<
    Record<string, string[]>
  >({});
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const subjectMap = useMemo(
    () => new Map(subjects.map((subject) => [subject.id, subject])),
    [subjects],
  );

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const { data, error } = await db()
          .from('subjects')
          .select('id,name,code')
          .eq('is_active', true)
          .order('name');

        if (error) throw error;
        if (live) setSubjects((data || []) as SubjectOption[]);
      } catch (error) {
        if (live) setMessage(reviewerErrorText(error));
      }
    })();

    return () => {
      live = false;
    };
  }, [version]);

  useEffect(() => {
    let live = true;

    const timer = setTimeout(async () => {
      try {
        let reviewerIds: string[] | null = null;

        if (filter) {
          const { data: links, error: linksError } = await db()
            .from('reviewer_subjects')
            .select('reviewer_id')
            .eq('subject_id', filter);

          if (linksError) throw linksError;

          reviewerIds = Array.from(
            new Set((links || []).map((item) => item.reviewer_id)),
          );

          if (!reviewerIds.length) {
            if (live) {
              setRows([]);
              setReviewerSubjects({});
            }
            return;
          }
        }

        let query = db()
          .from('reviewers')
          .select('*')
          .order('created_at', { ascending: false })
          .range(page * 10, page * 10 + 9);

        if (search) {
          query = query.ilike(
            'title',
            `%${search.replaceAll('%', '').replaceAll('_', '')}%`,
          );
        }

        if (reviewerIds) query = query.in('id', reviewerIds);

        const { data, error } = await query;
        if (error) throw error;

        const reviewerRows = (data || []) as Reviewer[];
        const ids = reviewerRows.map((row) => row.id);

        let links: { reviewer_id: string; subject_id: string }[] = [];

        if (ids.length) {
          const { data: linkData, error: linkError } = await db()
            .from('reviewer_subjects')
            .select('reviewer_id,subject_id')
            .in('reviewer_id', ids);

          if (linkError) throw linkError;
          links = linkData || [];
        }

        const map: Record<string, string[]> = {};
        for (const link of links) {
          map[link.reviewer_id] ||= [];
          map[link.reviewer_id].push(link.subject_id);
        }

        if (live) {
          setRows(reviewerRows);
          setReviewerSubjects(map);
        }
      } catch (error) {
        if (live) setMessage(reviewerErrorText(error));
      }
    }, 250);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [page, search, filter, version]);

  function openCreate() {
    rememberReviewerWorkspace();
    router.push('/reviewers/new');
  }

  function openEdit(id: string) {
    rememberReviewerWorkspace();
    router.push(`/reviewers/${id}`);
  }

  return (
    <div className="admin-standard-page reviewers-page">
      <div className="page-heading admin-page-heading">
        <div>
          <span className="eyebrow">CURATE THE LEARNING EXPERIENCE</span>
          <h1>Quizzes & Reviewers</h1>
          <p>
            Assign one or multiple subjects, then choose a fixed set or a
            randomized reviewer.
          </p>
        </div>

        <div className="actions admin-page-actions">
          <button type="button" onClick={openCreate}>
            + Create reviewer
          </button>
        </div>
      </div>

      <Notice message={message} />

      <div className="toolbar admin-compact-filters">
        <input
          aria-label="Search reviewers"
          type="search"
          placeholder="Search reviewer titles"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />

        <label>
          Subject filter
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All subjects</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
                {subject.code ? ` — ${subject.code}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel table-wrap reviewer-table-wrap">
        <table className="reviewer-records-table">
          <colgroup>
            <col className="reviewer-col-title" />
            <col className="reviewer-col-subjects" />
            <col className="reviewer-col-mode" />
            <col className="reviewer-col-status" />
            <col className="reviewer-col-manage" />
          </colgroup>

          <thead>
            <tr>
              <th>Reviewer</th>
              <th>Subjects</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Manage</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const linked = reviewerSubjects[row.id] || [row.subject_id];
              const subjectNames = linked
                .map((id) => subjectMap.get(id)?.name)
                .filter(Boolean)
                .join(', ');

              return (
                <tr className="record-row" key={row.id}>
                  <td>
                    {row.title}
                    <small>{row.description}</small>
                  </td>

                  <td>{subjectNames || '—'}</td>

                  <td>
                    {row.settings.selection === 'random'
                      ? `Randomized · ${row.settings.count}`
                      : 'Fixed'}
                    <small>
                      {row.settings.max_attempts ?? 'Unlimited'} attempts
                    </small>
                  </td>

                  <td>
                    <span className="pill">
                      {row.published ? 'Published' : 'Draft'}
                    </span>
                  </td>

                  <td>
                    <div className="actions">
                      <button
                        className="ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => openEdit(row.id)}
                      >
                        Edit
                      </button>

                      <button
                        className="ghost"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setMessage('');

                          try {
                            await rpc('duplicate_reviewer', {
                              source: row.id,
                            });
                            setVersion((value) => value + 1);
                            setMessage(
                              'Duplicated as an unpublished draft.',
                            );
                          } catch (error) {
                            setMessage(reviewerErrorText(error));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Duplicate
                      </button>

                      {row.published && (
                        <button
                          className="ghost"
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setMessage('');

                            try {
                              const { error } = await db()
                                .from('reviewers')
                                .update({ published: false })
                                .eq('id', row.id);

                              if (error) throw error;

                              setMessage(
                                'Unpublished. Existing attempts are preserved.',
                              );
                              setVersion((value) => value + 1);
                            } catch (error) {
                              setMessage(reviewerErrorText(error));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Unpublish
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!rows.length && (
          <div className="empty">
            No reviewers yet. Create a fixed or randomized reviewer.
          </div>
        )}
      </div>

      <div className="admin-standard-pager">
        <Pager page={page} setPage={setPage} more={rows.length === 10} />
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase';
import type { QuestionData, QuestionType } from '@/lib/types';
import { validateQuestion } from '@/lib/validation';
import {
  Check,
  ImageAttachment,
  Notice,
  Pager,
  uploadImage,
  errorText,
} from '../shared';
import ImportPanel from './ImportPanel';

type Row = {
  id?: string;
  subject_id: string;
  data: QuestionData;
  is_active: boolean;
};

type SubjectOption = {
  id: string;
  name: string;
  code: string;
};

const fresh = (subjectId: string): Row => ({
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

function typeLabel(type: QuestionType) {
  return type.replaceAll('_', ' ');
}

export default function Questions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [accepted, setAccepted] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [imports, setImports] = useState(false);

  const selectedSubject = subjects.find((item) => item.id === subject);

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
        if (live) setMessage(errorText(error));
      }
    })();

    return () => {
      live = false;
    };
  }, [version]);

  useEffect(() => {
    if (!subject) {
      setRows([]);
      return;
    }

    let live = true;

    const timer = setTimeout(async () => {
      try {
        let query = db()
          .from('questions')
          .select('*')
          .eq('subject_id', subject)
          .order('created_at', { ascending: false })
          .range(page * 10, page * 10 + 9);

        if (search) {
          query = query.ilike(
            'data->>text',
            `%${search.replaceAll('%', '').replaceAll('_', '')}%`,
          );
        }

        if (type) query = query.eq('data->>type', type);

        const { data, error } = await query;
        if (error) throw error;
        if (live) setRows((data || []) as Row[]);
      } catch (error) {
        if (live) setMessage(errorText(error));
      }
    }, 250);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [page, search, subject, type, version]);

  function edit(row: Row) {
    setEditing(structuredClone(row));
    setAccepted(row.data.accepted.map((item) => item.join(' | ')).join('\n'));
  }

  function field<K extends keyof QuestionData>(key: K, value: QuestionData[K]) {
    setEditing((row) =>
      row ? { ...row, data: { ...row.data, [key]: value } } : row,
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || !subject) return;

    setBusy(true);
    setMessage('');

    try {
      const question = {
        ...editing.data,
        accepted: accepted.trim()
          ? accepted
              .split('\n')
              .map((line) => line.split('|').map((item) => item.trim()))
          : [],
      };

      if (question.type.startsWith('mc_')) {
        question.accepted = [];
      } else {
        question.choices = [];
        question.correct = [];
      }

      if (question.type === 'long_answer') question.accepted = [];

      const errors = validateQuestion(question);
      if (errors.length) throw new Error(errors.join('; '));

      const { error } = await db()
        .from('questions')
        .upsert({
          ...editing,
          subject_id: subject,
          data: question,
        });

      if (error) throw error;

      setEditing(null);
      setVersion((value) => value + 1);
      setMessage('Question saved. Existing attempts are unchanged.');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function chooseSubject(value: string) {
    setSubject(value);
    setPage(0);
    setSearch('');
    setType('');
    setEditing(null);
    setImports(false);
    setMessage('');
  }

  return (
    <div className="admin-standard-page question-bank-page">
      <div className="page-heading admin-page-heading">
        <div>
          <span className="eyebrow">BUILD A BETTER LIBRARY</span>
          <h1>Question Bank</h1>
          <p>
            Choose a subject first. Questions added or imported here belong only
            to that subject.
          </p>
        </div>

        <div className="actions admin-page-actions">
          <button
            className="ghost"
            disabled={!subject}
            onClick={() => setImports((value) => !value)}
          >
            {imports ? '− Close import' : 'Import questions'}
          </button>

          <button
            disabled={!subject}
            onClick={() => {
              if (!subject) return;
              setEditing(fresh(subject));
              setAccepted('');
            }}
          >
            {editing && !editing.id ? '− Close new question' : '+ New question'}
          </button>
        </div>
      </div>

      <Notice message={message} />

      <section className="panel question-subject-selector">
        <label>
          Subject
          <select value={subject} onChange={(event) => chooseSubject(event.target.value)}>
            <option value="">Choose a subject</option>
            {subjects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.code ? ` — ${item.code}` : ''}
              </option>
            ))}
          </select>
        </label>

        {selectedSubject && (
          <p>
            Managing questions for <strong>{selectedSubject.name}</strong>
            {selectedSubject.code ? ` (${selectedSubject.code})` : ''}.
          </p>
        )}
      </section>

      {!subject ? (
        <div className="empty question-subject-empty">
          Select a subject to view, add, or import questions.
        </div>
      ) : (
        <>
          {imports && (
            <ImportPanel
              kind="questions"
              questionSubjectId={subject}
              onDone={() => setVersion((value) => value + 1)}
            />
          )}

          <div className="filter-grid admin-compact-filters question-bank-filters">
            <label>
              Search
              <input
                type="search"
                placeholder="Find question text"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>

            <label>
              Question type
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">All types</option>
                {[
                  'mc_single',
                  'mc_multi',
                  'fill_blank',
                  'short_answer',
                  'long_answer',
                  'multi_blank',
                ].map((item) => (
                  <option key={item} value={item}>
                    {item.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {editing && (
            <form className="panel editor stack admin-standard-editor" onSubmit={save}>
              <div className="section-line">
                <div>
                  <h2>{editing.id ? 'Edit question' : 'Create question'}</h2>
                  <p className="caption">
                    Subject: <strong>{selectedSubject?.name}</strong>
                  </p>
                </div>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </div>

              <div className="form-grid">
                <label>
                  Question type
                  <select
                    value={editing.data.type}
                    onChange={(event) => {
                      field('type', event.target.value as QuestionType);
                      field('correct', []);
                    }}
                  >
                    {[
                      'mc_single',
                      'mc_multi',
                      'fill_blank',
                      'short_answer',
                      'long_answer',
                      'multi_blank',
                    ].map((item) => (
                      <option key={item} value={item}>
                        {item.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Points
                  <input
                    type="number"
                    min="0.01"
                    max="10000"
                    step="0.01"
                    required
                    value={editing.data.points}
                    onChange={(event) => field('points', Number(event.target.value))}
                  />
                </label>
              </div>

              <label>
                Question text
                <textarea
                  rows={5}
                  maxLength={20000}
                  required
                  value={editing.data.text}
                  onChange={(event) => field('text', event.target.value)}
                />
              </label>

              {editing.data.type.startsWith('mc_') ? (
                <div className="stack">
                  <h3>Choices & correct answers</h3>
                  <p>
                    Select the correct choice
                    {editing.data.type === 'mc_multi' ? 's' : ''}.
                  </p>

                  {editing.data.choices.map((choice, index) => (
                    <div key={choice.id} className="choice-editor">
                      <input
                        aria-label={`Choice ${index + 1} is correct`}
                        type={
                          editing.data.type === 'mc_single' ? 'radio' : 'checkbox'
                        }
                        name="correct"
                        checked={editing.data.correct.includes(choice.id)}
                        onChange={(event) =>
                          field(
                            'correct',
                            editing.data.type === 'mc_single'
                              ? [choice.id]
                              : event.target.checked
                                ? [...editing.data.correct, choice.id]
                                : editing.data.correct.filter(
                                    (id) => id !== choice.id,
                                  ),
                          )
                        }
                      />

                      <input
                        aria-label={`Choice ${index + 1} text`}
                        required
                        value={choice.text}
                        onChange={(event) =>
                          field(
                            'choices',
                            editing.data.choices.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, text: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />

                      <button
                        className="ghost"
                        type="button"
                        onClick={() => {
                          field(
                            'choices',
                            editing.data.choices.filter(
                              (item) => item.id !== choice.id,
                            ),
                          );
                          field(
                            'correct',
                            editing.data.correct.filter(
                              (id) => id !== choice.id,
                            ),
                          );
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      field('choices', [
                        ...editing.data.choices,
                        { id: crypto.randomUUID(), text: '' },
                      ])
                    }
                  >
                    + Add choice
                  </button>
                </div>
              ) : editing.data.type !== 'long_answer' ? (
                <>
                  <label>
                    Accepted answers
                    <textarea
                      rows={4}
                      value={accepted}
                      onChange={(event) => setAccepted(event.target.value)}
                      placeholder="One blank per line. Separate variants with |"
                    />
                  </label>

                  <p className="caption">
                    One line per blank; separate accepted variants with |. Leave
                    blank only for manually reviewed short answers.
                  </p>

                  <Check
                    label="Strict text matching (case and whitespace sensitive)"
                    checked={editing.data.strict}
                    onChange={(value) => field('strict', value)}
                  />
                </>
              ) : (
                <div className="notice">
                  Paragraph responses are always manually graded.
                </div>
              )}

              <ImageAttachment path={editing.data.image_path} />

              <label>
                Optional image (PNG, JPEG, WebP; up to 5 MB)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;

                    setBusy(true);
                    try {
                      field('image_path', await uploadImage(file));
                    } catch (error) {
                      setMessage(errorText(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>

              {editing.data.image_path && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => field('image_path', null)}
                >
                  Remove image from question
                </button>
              )}

              <Check
                label="Active in question bank"
                checked={editing.is_active}
                onChange={(value) =>
                  setEditing({ ...editing, is_active: value })
                }
              />

              <button disabled={busy}>Save question</button>
            </form>
          )}

          <div className="panel table-wrap admin-compact-table">
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Type / Points</th>
                  <th>Status</th>
                  <th>Manage</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => (
                  <tr className="admin-record-row" key={row.id}>
                    <td className="question-cell">{row.data.text}</td>
                    <td>
                      {typeLabel(row.data.type)}
                      <small>
                        {row.data.points}{' '}
                        {row.data.points === 1 ? 'point' : 'points'}
                      </small>
                    </td>
                    <td>
                      <span className="pill">
                        {row.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        <button className="ghost" onClick={() => edit(row)}>
                          Edit
                        </button>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              !confirm(
                                'Delete this question? Questions used by reviewer sets must be removed from those sets first. Historical attempt snapshots remain intact.',
                              )
                            ) {
                              return;
                            }

                            const { error } = await db()
                              .from('questions')
                              .delete()
                              .eq('id', row.id!);

                            setMessage(
                              error
                                ? 'Cannot delete a linked question. Deactivate it or remove reviewer links first.'
                                : 'Question deleted.',
                            );

                            setVersion((value) => value + 1);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!rows.length && (
              <div className="empty">
                No questions yet for this subject.
              </div>
            )}
          </div>

          <div className="admin-standard-pager">
            <Pager page={page} setPage={setPage} more={rows.length === 10} />
          </div>
        </>
      )}
    </div>
  );
}

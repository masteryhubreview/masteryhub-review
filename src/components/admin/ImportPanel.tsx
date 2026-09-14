'use client';

import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { db, adminAccount } from '@/lib/supabase';
import { download, makeCSV } from '@/lib/csv';
import { validateQuestion, validateStudent } from '@/lib/validation';
import { Notice, errorText } from '../shared';
import type { QuestionData } from '@/lib/types';

type StudentImportData = {
  display_name: string;
  student_number: string;
  email: string;
  password: string;
  term_name: string;
  term_id: string;
  subject_labels: string[];
  subject_ids: string[];
  is_active: boolean;
};

type Preview = {
  line: number;
  row: Record<string, string>;
  data?: QuestionData;
  student?: StudentImportData;
  errors: string[];
  status: string;
};

type TermRow = {
  id: string;
  name: string;
};

type SubjectRow = {
  id: string;
  name: string;
  code: string;
};

type ExistingStudent = {
  email: string;
  student_number: string | null;
};

const STUDENT_HEADERS = [
  'Full Name',
  'Student Number',
  'Email',
  'Initial Password',
  'School Year / Term',
  'Subjects',
  'Active',
] as const;

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function key(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');
}

function parseActive(value: string) {
  const normalized = key(value);

  if (!normalized) return { value: true, error: '' };
  if (['true', 'yes', '1', 'active'].includes(normalized)) {
    return { value: true, error: '' };
  }
  if (['false', 'no', '0', 'inactive'].includes(normalized)) {
    return { value: false, error: '' };
  }

  return {
    value: true,
    error: 'Active must be TRUE or FALSE',
  };
}

function readStudentWorkbook(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet =
      workbook.Sheets.Students ||
      workbook.Sheets[workbook.SheetNames[0] || ''];

    if (!sheet) {
      throw new Error('The Excel file does not contain a worksheet.');
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    const headerRow = (matrix[0] || []).map((value) => clean(value));
    const missingHeaders = STUDENT_HEADERS.filter(
      (header) => !headerRow.includes(header),
    );

    if (missingHeaders.length) {
      throw new Error(
        `Template columns are missing or renamed: ${missingHeaders.join(', ')}`,
      );
    }

    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: false,
    });

    return records
      .map((record) => {
        const row: Record<string, string> = {
          display_name: clean(record['Full Name']),
          student_number: clean(record['Student Number']),
          email: clean(record.Email),
          password: clean(record['Initial Password']),
          term_name: clean(record['School Year / Term']),
          subjects: clean(record.Subjects),
          active: clean(record.Active),
        };

        return row;
      })
      .filter((row) => {
        const hasAnyValue = Object.values(row).some(
          (value) => value.trim().length > 0,
        );

        if (!hasAnyValue) return false;

        const looksLikeRepeatedHeader =
          key(row.display_name) === 'full name' &&
          key(row.student_number) === 'student number' &&
          key(row.email) === 'email';

        return !looksLikeRepeatedHeader;
      });
  });
}


type QuestionImportRow = {
  type: string;
  question: string;
  choices: string[];
  correct: string;
  points: string;
  explanation: string;
  accepted: string;
  strict: string;
};

const QUESTION_HEADERS = [
  'Question Type',
  'Question',
  'Choice A',
  'Choice B',
  'Choice C',
  'Choice D',
  'Choice E',
  'Choice F',
  'Correct Answer(s)',
  'Points',
  'Explanation',
  'Accepted Answer(s)',
  'Strict',
] as const;

function questionType(value: string): QuestionData['type'] {
  const normalized = key(value);

  const map: Record<string, QuestionData['type']> = {
    'multiple choice': 'mc_single',
    'multiple answers': 'mc_multi',
    'fill in the blank': 'fill_blank',
    'multiple blanks': 'multi_blank',
    'short answer': 'short_answer',
    'essay / long answer': 'long_answer',
    'essay': 'long_answer',
    'long answer': 'long_answer',
  };

  const result = map[normalized];
  if (!result) {
    throw new Error(`Unknown Question Type: ${value}`);
  }

  return result;
}

function makeQuestionData(row: QuestionImportRow): QuestionData & { explanation?: string } {
  const type = questionType(row.type);
  const points = Number(row.points || '1');

  if (!Number.isFinite(points) || points <= 0) {
    throw new Error('Points must be a number greater than 0');
  }

  const choices = row.choices
    .map((value, index) => ({
      id: String.fromCharCode(97 + index),
      text: value.trim(),
    }))
    .filter((choice) => choice.text);

  const correctLetters = row.correct
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  const correct = correctLetters.map((letter) => {
    const index = letter.charCodeAt(0) - 65;
    const choice = choices[index];

    if (!choice) {
      throw new Error(`Correct Answer(s) contains invalid choice "${letter}"`);
    }

    return choice.id;
  });

  const accepted =
    type === 'multi_blank'
      ? row.accepted
          .split(';')
          .map((blank) =>
            blank
              .split('|')
              .map((value) => value.trim())
              .filter(Boolean),
          )
          .filter((blank) => blank.length)
      : row.accepted.trim()
        ? [
            row.accepted
              .split('|')
              .map((value) => value.trim())
              .filter(Boolean),
          ]
        : [];

  const data = {
    type,
    text: row.question.trim(),
    points,
    strict: ['true', 'yes', '1'].includes(key(row.strict)),
    image_path: null,
    choices: type.startsWith('mc_') ? choices : [],
    correct: type.startsWith('mc_') ? correct : [],
    accepted:
      type === 'long_answer' || type.startsWith('mc_')
        ? []
        : accepted,
    explanation: row.explanation.trim(),
  } as QuestionData & { explanation?: string };

  const errors = validateQuestion(data);
  if (errors.length) {
    throw new Error(errors.join('; '));
  }

  return data;
}

function recordsToQuestionRows(
  records: Record<string, unknown>[],
): QuestionImportRow[] {
  return records
    .map((record) => ({
      type: clean(record['Question Type']),
      question: clean(record.Question),
      choices: ['A', 'B', 'C', 'D', 'E', 'F'].map((letter) =>
        clean(record[`Choice ${letter}`]),
      ),
      correct: clean(record['Correct Answer(s)']),
      points: clean(record.Points),
      explanation: clean(record.Explanation),
      accepted: clean(record['Accepted Answer(s)']),
      strict: clean(record.Strict),
    }))
    .filter((row) =>
      [
        row.type,
        row.question,
        ...row.choices,
        row.correct,
        row.points,
        row.explanation,
        row.accepted,
        row.strict,
      ].some(Boolean),
    );
}

async function readQuestionWorkbook(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet =
    workbook.Sheets.Questions ||
    workbook.Sheets[workbook.SheetNames[0] || ''];

  if (!sheet) {
    throw new Error('The workbook does not contain a Questions sheet.');
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  const headerRow = (matrix[0] || []).map((value) => clean(value));
  const missing = QUESTION_HEADERS.filter(
    (header) => !headerRow.includes(header),
  );

  if (missing.length) {
    throw new Error(
      `Template columns are missing or renamed: ${missing.join(', ')}`,
    );
  }

  return recordsToQuestionRows(
    XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: false,
    }),
  );
}

async function readQuestionDocx(file: File) {
  const mammoth = await import('mammoth');
  const result = await mammoth.convertToHtml({
    arrayBuffer: await file.arrayBuffer(),
  });

  const document = new DOMParser().parseFromString(
    result.value,
    'text/html',
  );
  const table = document.querySelector('table');

  if (!table) {
    throw new Error('The Word file does not contain the question table.');
  }

  const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('th,td')).map((cell) =>
      clean(cell.textContent),
    ),
  );

  if (!rows.length) {
    throw new Error('The Word question table is empty.');
  }

  const header = rows[0];
  const missing = QUESTION_HEADERS.filter(
    (name) => !header.includes(name),
  );

  if (missing.length) {
    throw new Error(
      `Template columns are missing or renamed: ${missing.join(', ')}`,
    );
  }

  const records = rows.slice(1).map((values) => {
    const record: Record<string, unknown> = {};

    header.forEach((name, index) => {
      record[name] = values[index] || '';
    });

    return record;
  });

  return recordsToQuestionRows(records);
}

export default function ImportPanel({
  kind,
  onDone,
  questionSubjectId,
}: {
  kind: 'students' | 'questions';
  onDone: (
    importedQuestions?: {
      id: string;
      subject_id: string;
      text: string;
    }[],
  ) => void;
  questionSubjectId?: string;
}) {
  const [text, setText] = useState('');
  const [studentRows, setStudentRows] = useState<Record<string, string>[]>([]);
  const [studentFileName, setStudentFileName] = useState('');
  const [preview, setPreview] = useState<Preview[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState<TermRow[]>([]);
  const [acceptedSubjects, setAcceptedSubjects] = useState<SubjectRow[]>([]);
  const [questionFileName, setQuestionFileName] = useState('');

  useEffect(() => {
    if (kind !== 'students') return;

    let cancelled = false;

    async function loadAcceptedValues() {
      const [
        { data: terms, error: termsError },
        { data: subjects, error: subjectsError },
      ] = await Promise.all([
        db()
          .from('terms')
          .select('id,name')
          .eq('is_active', true)
          .order('name'),
        db()
          .from('subjects')
          .select('id,name,code')
          .eq('is_active', true)
          .order('name'),
      ]);

      if (cancelled) return;

      if (!termsError) {
        setAcceptedTerms((terms || []) as TermRow[]);
      }

      if (!subjectsError) {
        setAcceptedSubjects((subjects || []) as SubjectRow[]);
      }
    }

    loadAcceptedValues();

    return () => {
      cancelled = true;
    };
  }, [kind]);

  async function importQuestionFile(file: File) {
    if (!questionSubjectId) {
      setMessage('Choose a subject before importing questions.');
      return;
    }

    setBusy(true);
    setMessage('');
    setQuestionFileName(file.name);

    try {
      const lower = file.name.toLowerCase();
      const rows = lower.endsWith('.docx')
        ? await readQuestionDocx(file)
        : await readQuestionWorkbook(file);

      if (!rows.length) {
        throw new Error('No completed question rows were found in the file.');
      }

      const parsed = rows.map((row, index) => {
        try {
          return makeQuestionData(row);
        } catch (error) {
          throw new Error(`Row ${index + 2}: ${errorText(error)}`);
        }
      });

      const { data: inserted, error } = await db()
        .from('questions')
        .insert(
          parsed.map((data) => ({
            subject_id: questionSubjectId,
            data,
            is_active: true,
          })),
        )
        .select('id,subject_id,data');

      if (error) throw error;

      setMessage(
        `${parsed.length} question${parsed.length === 1 ? '' : 's'} imported and added directly to this subject.`,
      );

      onDone(
        (inserted || []).map((row) => ({
          id: row.id,
          subject_id: row.subject_id,
          text: row.data?.text || 'Untitled question',
        })),
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    if (kind !== 'students') return;

    setBusy(true);
    setMessage('');

    try {
      if (kind === 'students') {
        if (!studentRows.length) {
          throw new Error('Choose a completed student Excel template first.');
        }

        const [{ data: terms, error: termsError }, { data: subjects, error: subjectsError }, { data: existing, error: existingError }] =
          await Promise.all([
            db()
              .from('terms')
              .select('id,name')
              .eq('is_active', true)
              .order('name'),
            db()
              .from('subjects')
              .select('id,name,code')
              .eq('is_active', true)
              .order('name'),
            db()
              .from('profiles')
              .select('email,student_number')
              .eq('role', 'student'),
          ]);

        if (termsError) throw termsError;
        if (subjectsError) throw subjectsError;
        if (existingError) throw existingError;

        const termRows = (terms || []) as TermRow[];
        const subjectRows = (subjects || []) as SubjectRow[];
        const existingRows = (existing || []) as ExistingStudent[];

        const termByName = new Map<string, TermRow>();
        for (const term of termRows) {
          termByName.set(key(term.name), term);
        }

        const subjectMatches = new Map<string, SubjectRow[]>();
        for (const subject of subjectRows) {
          for (const label of [subject.code, subject.name]) {
            const normalized = key(label);
            if (!normalized) continue;
            const matches = subjectMatches.get(normalized) || [];
            matches.push(subject);
            subjectMatches.set(normalized, matches);
          }
        }

        const existingEmails = new Set(
          existingRows.map((item) => key(item.email)),
        );
        const existingStudentNumbers = new Set(
          existingRows
            .map((item) => key(item.student_number || ''))
            .filter(Boolean),
        );

        const seenEmails = new Set<string>();
        const seenStudentNumbers = new Set<string>();

        const result: Preview[] = studentRows.map((row, index) => {
          const errors = validateStudent({
            display_name: row.display_name,
            email: row.email,
            password: row.password,
          });

          const email = key(row.email);
          const studentNumber = key(row.student_number);

          if (email) {
            if (seenEmails.has(email)) {
              errors.push('Duplicate email in file');
            }
            if (existingEmails.has(email)) {
              errors.push('Email already exists in the system');
            }
            seenEmails.add(email);
          }

          if (studentNumber) {
            if (seenStudentNumbers.has(studentNumber)) {
              errors.push('Duplicate student number in file');
            }
            if (existingStudentNumbers.has(studentNumber)) {
              errors.push('Student number already exists in the system');
            }
            seenStudentNumbers.add(studentNumber);
          }

          const termName = row.term_name.trim();
          const matchedTerm = termByName.get(key(termName));

          if (!termName) {
            errors.push('School Year / Term is required');
          } else if (!matchedTerm) {
            errors.push(
              `Unknown or inactive School Year / Term: ${termName}`,
            );
          }

          const subjectLabels = row.subjects
            .split(';')
            .map((value) => value.trim())
            .filter(Boolean);

          if (!subjectLabels.length) {
            errors.push('At least one Subject is required');
          }

          const subjectIds: string[] = [];

          for (const label of subjectLabels) {
            const matches = subjectMatches.get(key(label)) || [];

            if (!matches.length) {
              errors.push(`Unknown or inactive Subject: ${label}`);
              continue;
            }

            const uniqueMatches = Array.from(
              new Map(matches.map((item) => [item.id, item])).values(),
            );

            if (uniqueMatches.length > 1) {
              errors.push(
                `Subject "${label}" matches more than one subject. Use its unique subject code.`,
              );
              continue;
            }

            if (!subjectIds.includes(uniqueMatches[0].id)) {
              subjectIds.push(uniqueMatches[0].id);
            }
          }

          const active = parseActive(row.active);
          if (active.error) errors.push(active.error);

          return {
            line: index + 2,
            row,
            student: {
              display_name: row.display_name.trim(),
              student_number: row.student_number.trim(),
              email: row.email.trim().toLowerCase(),
              password: row.password,
              term_name: termName,
              term_id: matchedTerm?.id || '',
              subject_labels: subjectLabels,
              subject_ids: subjectIds,
              is_active: active.value,
            },
            errors,
            status: '',
          };
        });

        setPreview(result);
        setMessage(
          `${result.length} student row${result.length === 1 ? '' : 's'} previewed. ${
            result.some((item) => item.errors.length)
              ? 'Fix the highlighted validation errors in the Excel file, then upload it again.'
              : 'All rows are ready to import.'
          }`,
        );
      }
    } catch (error) {
      setPreview([]);
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function importRows() {
    if (kind !== 'students') return;

    setBusy(true);
    let count = 0;

    for (let index = 0; index < preview.length; index += 1) {
      const item = preview[index];

      if (item.errors.length || item.status === 'Imported') continue;

      let createdStudentId = '';

      try {
        if (kind === 'students') {
          if (!item.student) {
            throw new Error('Student import data is incomplete.');
          }

          const student = item.student;

          const accountResult = await adminAccount({
            action: 'create',
            display_name: student.display_name,
            student_number: student.student_number,
            email: student.email,
            password: student.password,
            term_id: student.term_id,
          });

          createdStudentId = accountResult?.id || '';

          if (!createdStudentId) {
            throw new Error('Student account was created without an ID.');
          }

          if (student.subject_ids.length) {
            const { error: enrollmentError } = await db()
              .from('enrollments')
              .insert(
                student.subject_ids.map((subjectId) => ({
                  student_id: createdStudentId,
                  subject_id: subjectId,
                  term_id: student.term_id,
                  is_active: true,
                })),
              );

            if (enrollmentError) throw enrollmentError;
          }

          if (!student.is_active) {
            await adminAccount({
              action: 'update',
              id: createdStudentId,
              display_name: student.display_name,
              student_number: student.student_number,
              email: student.email,
              term_id: student.term_id,
              is_active: false,
            });
          }
        }

        item.status = 'Imported';
        count += 1;
      } catch (error) {
        const failure = errorText(error);

        if (kind === 'students' && createdStudentId) {
          try {
            await adminAccount({
              action: 'delete',
              id: createdStudentId,
              backup_verified: true,
            });
            item.status = failure;
          } catch (cleanupError) {
            item.status = `${failure} Cleanup also failed: ${errorText(
              cleanupError,
            )}`;
          }
        } else {
          item.status = failure;
        }
      }

      setPreview([...preview]);
    }

    setBusy(false);
    setMessage(
      `${count} row${count === 1 ? '' : 's'} imported in this run. Failed rows remain visible.`,
    );
    onDone();
  }


  function downloadStudentTemplate() {
    const anchor = document.createElement('a');
    anchor.href = `/templates/reviewhub-student-import-template-v2.xlsx?v=20260913b`;
    anchor.download = 'reviewhub-student-import-template-v2.xlsx';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }


  function downloadQuestionTemplate(format: 'xlsx' | 'docx') {
    const anchor = document.createElement('a');
    anchor.href =
      format === 'xlsx'
        ? '/templates/reviewhub-question-import-template.xlsx'
        : '/templates/reviewhub-question-import-template.docx';
    anchor.download =
      format === 'xlsx'
        ? 'reviewhub-question-import-template.xlsx'
        : 'reviewhub-question-import-template.docx';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <section className="panel stack admin-import-panel">
      <div className="section-line">
        <h2>
          {kind === 'questions'
            ? 'Import Questions'
            : 'Import students'}
        </h2>

        {kind === 'students' ? (
          <button
            className="ghost"
            type="button"
            disabled={busy}
            onClick={downloadStudentTemplate}
          >
            Download template
          </button>
        ) : (
          <div className="actions admin-inline-actions">
            <button
              className="ghost"
              type="button"
              disabled={busy}
              onClick={() => downloadQuestionTemplate('xlsx')}
            >
              Download Excel / Sheets Template
            </button>
            <button
              className="ghost"
              type="button"
              disabled={busy}
              onClick={() => downloadQuestionTemplate('docx')}
            >
              Download Word Template
            </button>
          </div>
        )}
      </div>

      <p>
        {kind === 'questions'
          ? 'Use the fixed-header Excel/Google Sheets or Download Word Template. Choose the completed file and the questions will be validated and added directly to this subject—there is no separate preview/review step.'
          : 'Download the formatted student template and open it in Microsoft Excel, or import it into Google Sheets. If you use Google Sheets, download the completed file as Microsoft Excel (.xlsx) before uploading it here. Student accounts can be assigned to an existing school year / term and one or multiple subjects during the same import. Keep the template column names unchanged.'}
      </p>

      {kind === 'students' ? (
        <>
          <input
            aria-label="Student Excel file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;

              setPreview([]);
              setMessage('');

              try {
                const rows = await readStudentWorkbook(file);
                setStudentRows(rows);
                setStudentFileName(file.name);
                setMessage(
                  `${rows.length} student row${rows.length === 1 ? '' : 's'} loaded from ${file.name}. Click Preview & validate before importing.`,
                );
              } catch (error) {
                setStudentRows([]);
                setStudentFileName('');
                setMessage(errorText(error));
              }
            }}
          />

          <div className="admin-import-format-note">
            <strong>Using Google Sheets?</strong>{' '}
            Import the downloaded template into Google Sheets, complete the student details,
            then choose <strong>File → Download → Microsoft Excel (.xlsx)</strong> before
            uploading it here.
          </div>

          <div className="admin-import-validation-warning">
            <strong>Before you import:</strong>{' '}
            The import will not proceed if any information is incorrect or does not match
            what is currently set up in the system. For example, if <strong>Science</strong>{' '}
            is included in a student's Subjects column but Science has not been added as an
            active subject in the Subjects page, the file will fail validation. Fix the
            unmatched information first, then upload and validate the file again.
          </div>

          <div className="admin-import-accepted-values">
            <div>
              <strong>Accepted School Year / Term</strong>
              <span>
                {acceptedTerms.length
                  ? acceptedTerms.map((term) => term.name).join(' • ')
                  : 'No active terms found.'}
              </span>
            </div>

            <div>
              <strong>Accepted Subjects</strong>
              <span>
                {acceptedSubjects.length
                  ? acceptedSubjects
                      .map((subject) =>
                        subject.code
                          ? `${subject.code} — ${subject.name}`
                          : subject.name,
                      )
                      .join(' • ')
                  : 'No active subjects found.'}
              </span>
            </div>
          </div>

          {studentFileName && (
            <p className="admin-import-file-note">
              Selected file: <strong>{studentFileName}</strong>
            </p>
          )}
        </>
      ) : (
        <>
          <input
            aria-label="Question import file"
            type="file"
            accept=".xlsx,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy}
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];

              if (!file) return;

              try {
                await importQuestionFile(file);
              } finally {
                input.value = '';
              }
            }}
          />

          <div className="admin-import-format-note">
            <strong>Accepted files:</strong>{' '}
            Excel / Google Sheets export (.xlsx) or the formatted Word template (.docx).
            CSV is no longer used for question imports.
          </div>

          <div className="admin-import-format-note">
            <strong>Direct import:</strong>{' '}
            keep the template headers unchanged. The system checks the file and immediately adds valid questions to this subject. If any row is invalid, nothing is imported and the error identifies the row to fix.
          </div>

          {questionFileName && (
            <p className="admin-import-file-note">
              Last selected file: <strong>{questionFileName}</strong>
            </p>
          )}
        </>
      )}

      {kind === 'students' && (
        <div className="actions admin-inline-actions">
          <button
            className="ghost"
            disabled={busy || !studentRows.length}
            onClick={validate}
          >
            {busy ? 'Checking...' : 'Preview & validate'}
          </button>

          <button
            disabled={
              busy ||
              !preview.length ||
              preview.some((row) => row.errors.length > 0)
            }
            onClick={importRows}
          >
            {busy ? 'Importing...' : 'Confirm import'}
          </button>

          <button
            className="ghost"
            disabled={!preview.length}
            onClick={() =>
              download(
                'import-report.csv',
                makeCSV(
                  preview.map((item) => ({
                    row: item.line,
                    record:
                      item.student?.display_name ||
                      item.row.email ||
                      item.data?.text ||
                      '',
                    email: item.student?.email || item.row.email || '',
                    term: item.student?.term_name || '',
                    subjects: item.student?.subject_labels.join('; ') || '',
                    status: item.status,
                    errors: item.errors.join('; '),
                  })),
                )
              )
            }
          >
            Export import report
          </button>
        </div>
      )}

      <Notice message={message} />

      {kind === 'students' && !!preview.length && (
        <div className="import-preview">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Record</th>
                {kind === 'students' && <th>Term / Subjects</th>}
                <th>Validation / Status</th>
              </tr>
            </thead>

            <tbody>
              {preview.slice(0, 100).map((row) => (
                <tr key={row.line}>
                  <td>{row.line}</td>
                  <td>
                    {row.student?.display_name ||
                      row.row.display_name ||
                      row.data?.text ||
                      'Invalid record'}
                    {row.student?.email && (
                      <>
                        <br />
                        <small>{row.student.email}</small>
                      </>
                    )}
                  </td>

                  {kind === 'students' && (
                    <td>
                      {row.student?.term_name || '—'}
                      <br />
                      <small>
                        {row.student?.subject_labels.join('; ') || '—'}
                      </small>
                    </td>
                  )}

                  <td>
                    {row.errors.join('; ') || row.status || 'Ready'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {preview.length > 100 && (
            <p>
              Showing the first 100 rows. Download the report for every row.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

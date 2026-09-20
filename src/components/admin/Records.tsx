'use client';

import { Fragment, useEffect, useState } from 'react';
import { db, adminAccount } from '@/lib/supabase';
import * as XLSX from 'xlsx';
import { Notice, Pager, Check, errorText } from '../shared';
import RemoteSelect from './RemoteSelect';
import ImportPanel from './ImportPanel';

type Row = {
  id?: string;
  display_name?: string;
  email?: string;
  student_number?: string;
  password?: string;
  term_id?: string;
  name?: string;
  code?: string;
  description?: string;
  student_id?: string;
  subject_id?: string;
  is_active: boolean;
  profiles?: { display_name: string };
  subjects?: { name: string };
  terms?: { name: string };
};

type TermOption = {
  id: string;
  name: string;
};

type SubjectOption = {
  id: string;
  name: string;
  code?: string;
};

type StudentOption = {
  id: string;
  display_name: string;
  email?: string;
  student_number?: string;
};

type SubjectStudent = {
  id: string;
  student_id: string;
  term_id?: string;
  profiles?: {
    display_name: string;
    email?: string;
    student_number?: string;
  };
  terms?: {
    name: string;
  };
};

type SubjectQuestion = {
  id: string;
  data: {
    text?: string;
    type?: string;
    points?: number;
    explanation?: string;
  };
  is_active: boolean;
};

export default function Records({ tab }: { tab: string }) {
  const table =
    tab === 'Students'
      ? 'profiles'
      : tab === 'Subjects'
        ? 'subjects'
        : tab === 'Terms'
          ? 'terms'
          : 'enrollments';

  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [termOptions, setTermOptions] = useState<TermOption[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [studentSubjectSearch, setStudentSubjectSearch] = useState('');
  const [enrollmentStudentSearch, setEnrollmentStudentSearch] = useState('');
  const [enrollmentStudentResults, setEnrollmentStudentResults] = useState<StudentOption[]>([]);
  const [selectedEnrollmentStudents, setSelectedEnrollmentStudents] = useState<StudentOption[]>([]);
  const [selectedEnrollmentSubjects, setSelectedEnrollmentSubjects] = useState<string[]>([]);
  const [expandedSubject, setExpandedSubject] = useState('');
  const [subjectStudents, setSubjectStudents] = useState<SubjectStudent[]>([]);
  const [subjectStudentsBusy, setSubjectStudentsBusy] = useState(false);
  const [subjectRosterTerm, setSubjectRosterTerm] = useState('');
  const [subjectEnrollOpen, setSubjectEnrollOpen] = useState(false);
  const [subjectEnrollSearch, setSubjectEnrollSearch] = useState('');
  const [subjectEnrollResults, setSubjectEnrollResults] = useState<StudentOption[]>([]);
  const [subjectEnrollSelected, setSubjectEnrollSelected] = useState<StudentOption[]>([]);
  const [subjectEnrollTerm, setSubjectEnrollTerm] = useState('');
  const [expandedSubjectQuestions, setExpandedSubjectQuestions] = useState('');
  const [subjectQuestions, setSubjectQuestions] = useState<SubjectQuestion[]>([]);
  const [subjectQuestionsBusy, setSubjectQuestionsBusy] = useState(false);
  const [subjectQuestionSearch, setSubjectQuestionSearch] = useState('');
  const [subjectQuestionImportOpen, setSubjectQuestionImportOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [imports, setImports] = useState(false);

  const reload = () => setVersion((value) => value + 1);

  useEffect(() => {
    if (!['Students', 'Subjects'].includes(tab)) return;

    let live = true;

    (async () => {
      try {
        const { data, error } = await db()
          .from('terms')
          .select('id,name')
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (live) {
          setTermOptions((data || []) as TermOption[]);
        }
      } catch (error) {
        if (live) setMessage(errorText(error));
      }
    })();

    return () => {
      live = false;
    };
  }, [tab, version]);

  useEffect(() => {
    if (!['Students', 'Subjects'].includes(tab)) return;

    let live = true;

    (async () => {
      try {
        const { data, error } = await db()
          .from('subjects')
          .select('id,name,code')
          .eq('is_active', true)
          .order('name');

        if (error) throw error;
        if (live) setSubjectOptions((data || []) as SubjectOption[]);
      } catch (error) {
        if (live) setMessage(errorText(error));
      }
    })();

    return () => {
      live = false;
    };
  }, [tab, version]);

  useEffect(() => {
    if (table !== 'profiles' || !editing?.id || !editing.term_id) {
      if (table === 'profiles' && !editing?.id) setSelectedSubjects([]);
      return;
    }

    let live = true;

    (async () => {
      try {
        const { data, error } = await db()
          .from('enrollments')
          .select('subject_id,is_active')
          .eq('student_id', editing.id)
          .eq('term_id', editing.term_id);

        if (error) throw error;
        if (live) {
          setSelectedSubjects(
            (data || [])
              .filter((item) => item.is_active)
              .map((item) => item.subject_id),
          );
        }
      } catch (error) {
        if (live) setMessage(errorText(error));
      }
    })();

    return () => {
      live = false;
    };
  }, [table, editing?.id, editing?.term_id, version]);

  useEffect(() => {
    if (
      table !== 'enrollments' ||
      !editing?.id ||
      !editing.student_id ||
      !editing.term_id
    ) {
      if (table === 'enrollments' && !editing?.id) {
        setSelectedEnrollmentSubjects([]);
      }
      return;
    }

    let live = true;

    (async () => {
      try {
        const { data, error } = await db()
          .from('enrollments')
          .select('subject_id,is_active')
          .eq('student_id', editing.student_id)
          .eq('term_id', editing.term_id);

        if (error) throw error;

        if (live) {
          setSelectedEnrollmentSubjects(
            (data || [])
              .filter((item) => item.is_active)
              .map((item) => item.subject_id),
          );
        }
      } catch (error) {
        if (live) setMessage(errorText(error));
      }
    })();

    return () => {
      live = false;
    };
  }, [
    table,
    editing?.id,
    editing?.student_id,
    editing?.term_id,
    version,
  ]);

  useEffect(() => {
    if (table !== 'enrollments' || editing?.id || !enrollmentStudentSearch.trim()) {
      setEnrollmentStudentResults([]);
      return;
    }

    let live = true;
    const timer = setTimeout(async () => {
      try {
        const clean = enrollmentStudentSearch
          .trim()
          .replaceAll('%', '')
          .replaceAll('_', '')
          .replaceAll(',', '');

        const { data, error } = await db()
          .from('profiles')
          .select('id,display_name,email,student_number')
          .eq('role', 'student')
          .eq('is_active', true)
          .or(
            `display_name.ilike.%${clean}%,email.ilike.%${clean}%,student_number.ilike.%${clean}%`,
          )
          .order('display_name')
          .limit(8);

        if (error) throw error;
        if (live) {
          const already = new Set(selectedEnrollmentStudents.map((student) => student.id));
          setEnrollmentStudentResults(
            ((data || []) as StudentOption[]).filter((student) => !already.has(student.id)),
          );
        }
      } catch (error) {
        if (live) setMessage(errorText(error));
      }
    }, 180);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [table, editing?.id, enrollmentStudentSearch, selectedEnrollmentStudents]);

  useEffect(() => {
    let live = true;

    const timer = setTimeout(async () => {
      try {
        let query = db()
          .from(table)
          .select(
            table === 'enrollments'
              ? '*,profiles(display_name),subjects(name),terms(name)'
              : '*',
          )
          .order('created_at', { ascending: false })
          .range(page * 10, page * 10 + 9);

        if (table === 'profiles') {
          query = query.eq('role', 'student');
          if (term) query = query.eq('term_id', term);
        }

        if (search && table !== 'enrollments') {
          query = query.ilike(
            table === 'profiles' ? 'display_name' : 'name',
            `%${search.replaceAll('%', '').replaceAll('_', '')}%`,
          );
        }

        const { data, error } = await query;
        if (error) throw error;

        if (live) {
          setRows((data || []) as unknown as Row[]);
        }
      } catch (error) {
        setMessage(errorText(error));
      }
    }, 250);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [table, page, search, term, version]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;

    setBusy(true);
    setMessage('');

    try {
      if (table === 'profiles') {
        const accountResult = await adminAccount({
          ...editing,
          action: editing.id ? 'update' : 'create',
        });

        const studentId = editing.id || accountResult?.id;
        const termId = editing.term_id || '';

        if (studentId && termId) {
          const { data: existing, error: existingError } = await db()
            .from('enrollments')
            .select('id,subject_id,is_active')
            .eq('student_id', studentId)
            .eq('term_id', termId);

          if (existingError) throw existingError;

          const existingBySubject = new Map(
            (existing || []).map((item) => [item.subject_id, item]),
          );

          for (const subjectId of selectedSubjects) {
            const current = existingBySubject.get(subjectId);
            if (current) {
              if (!current.is_active) {
                const { error } = await db()
                  .from('enrollments')
                  .update({ is_active: true })
                  .eq('id', current.id);
                if (error) throw error;
              }
            } else {
              const { error } = await db().from('enrollments').insert({
                student_id: studentId,
                subject_id: subjectId,
                term_id: termId,
                is_active: true,
              });
              if (error) throw error;
            }
          }

          const selected = new Set(selectedSubjects);
          const toDeactivate = (existing || [])
            .filter((item) => item.is_active && !selected.has(item.subject_id))
            .map((item) => item.id);

          if (toDeactivate.length) {
            const { error } = await db()
              .from('enrollments')
              .update({ is_active: false })
              .in('id', toDeactivate);
            if (error) throw error;
          }
        }
      } else if (table === 'enrollments' && !editing.id) {
        if (!selectedEnrollmentStudents.length) {
          throw new Error('Add at least one student.');
        }
        if (!selectedEnrollmentSubjects.length) {
          throw new Error('Select at least one subject.');
        }
        if (!editing.term_id) throw new Error('Select a school year / semester.');

        for (const student of selectedEnrollmentStudents) {
          for (const subjectId of selectedEnrollmentSubjects) {
            const { data: current, error: lookupError } = await db()
              .from('enrollments')
              .select('id,is_active')
              .eq('student_id', student.id)
              .eq('subject_id', subjectId)
              .eq('term_id', editing.term_id)
              .maybeSingle();

            if (lookupError) throw lookupError;

            if (current) {
              const { error } = await db()
                .from('enrollments')
                .update({ is_active: true })
                .eq('id', current.id);
              if (error) throw error;
            } else {
              const { error } = await db().from('enrollments').insert({
                student_id: student.id,
                subject_id: subjectId,
                term_id: editing.term_id,
                is_active: true,
              });
              if (error) throw error;
            }
          }
        }
      } else if (table === 'enrollments' && editing.id) {
        if (!editing.student_id) throw new Error('Select a student.');
        if (!editing.term_id) throw new Error('Select a school year / semester.');
        if (!selectedEnrollmentSubjects.length) {
          throw new Error('Select at least one subject.');
        }

        const { data: existing, error: existingError } = await db()
          .from('enrollments')
          .select('id,subject_id,is_active')
          .eq('student_id', editing.student_id)
          .eq('term_id', editing.term_id);

        if (existingError) throw existingError;

        const existingBySubject = new Map(
          (existing || []).map((item) => [item.subject_id, item]),
        );

        for (const subjectId of selectedEnrollmentSubjects) {
          const current = existingBySubject.get(subjectId);

          if (current) {
            const { error } = await db()
              .from('enrollments')
              .update({ is_active: editing.is_active })
              .eq('id', current.id);
            if (error) throw error;
          } else {
            const { error } = await db().from('enrollments').insert({
              student_id: editing.student_id,
              subject_id: subjectId,
              term_id: editing.term_id,
              is_active: editing.is_active,
            });
            if (error) throw error;
          }
        }

        const selected = new Set(selectedEnrollmentSubjects);
        const toDeactivate = (existing || [])
          .filter((item) => item.is_active && !selected.has(item.subject_id))
          .map((item) => item.id);

        if (toDeactivate.length) {
          const { error } = await db()
            .from('enrollments')
            .update({ is_active: false })
            .in('id', toDeactivate);
          if (error) throw error;
        }
      } else {
        const payload = { ...editing };
        delete payload.profiles;
        delete payload.subjects;
        delete payload.terms;

        const { error } = await db().from(table).upsert(payload);
        if (error) throw error;
      }

      setEditing(null);
      setSelectedSubjects([]);
      setStudentSubjectSearch('');
      setSelectedEnrollmentStudents([]);
      setSelectedEnrollmentSubjects([]);
      setEnrollmentStudentSearch('');
      reload();
      setMessage(
        table === 'enrollments'
          ? 'Enrollment saved.'
          : table === 'profiles'
            ? 'Student saved.'
            : 'Saved.',
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function addEnrollmentStudent(student: StudentOption) {
    setSelectedEnrollmentStudents((current) =>
      current.some((item) => item.id === student.id) ? current : [...current, student],
    );
    setEnrollmentStudentSearch('');
    setEnrollmentStudentResults([]);
  }

  function removeEnrollmentStudent(studentId: string) {
    setSelectedEnrollmentStudents((current) =>
      current.filter((student) => student.id !== studentId),
    );
  }

  function toggleEnrollmentSubject(subjectId: string) {
    setSelectedEnrollmentSubjects((current) =>
      current.includes(subjectId)
        ? current.filter((id) => id !== subjectId)
        : [...current, subjectId],
    );
  }

  function getStudentSubjectMatches() {
    const query = studentSubjectSearch.trim().toLowerCase();

    if (!query) return [];

    return subjectOptions
      .filter((subject) => !selectedSubjects.includes(subject.id))
      .filter(
        (subject) =>
          subject.name.toLowerCase().includes(query) ||
          (subject.code || '').toLowerCase().includes(query),
      )
      .sort((a, b) => {
        const aExact =
          a.name.toLowerCase() === query ||
          (a.code || '').toLowerCase() === query;
        const bExact =
          b.name.toLowerCase() === query ||
          (b.code || '').toLowerCase() === query;

        if (aExact !== bExact) return aExact ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }

  function addStudentSubject(subject?: SubjectOption) {
    const match = subject || getStudentSubjectMatches()[0];

    if (!studentSubjectSearch.trim() && !subject) {
      setMessage('Type a subject name or code first.');
      return;
    }

    if (!match) {
      setMessage('No matching active subject found.');
      return;
    }

    setSelectedSubjects((current) =>
      current.includes(match.id) ? current : [...current, match.id],
    );
    setStudentSubjectSearch('');
    setMessage('');
  }

  function removeStudentSubject(subjectId: string) {
    setSelectedSubjects((current) =>
      current.filter((id) => id !== subjectId),
    );
  }

  function field(key: keyof Row, value: unknown) {
    setEditing((row) => (row ? { ...row, [key]: value } : row));
  }

  async function toggleSubjectStudents(subjectId: string) {
    if (expandedSubject === subjectId) {
      setExpandedSubject('');
      setSubjectStudents([]);
      setSubjectRosterTerm('');
      setSubjectEnrollOpen(false);
      setSubjectEnrollSearch('');
      setSubjectEnrollResults([]);
      setSubjectEnrollSelected([]);
      setSubjectEnrollTerm('');
      return;
    }

    setExpandedSubject(subjectId);
    setSubjectStudents([]);
    setSubjectRosterTerm('');
    setSubjectEnrollOpen(false);
    setSubjectEnrollSearch('');
    setSubjectEnrollResults([]);
    setSubjectEnrollSelected([]);
    setSubjectEnrollTerm('');
    setSubjectStudentsBusy(true);
    setMessage('');

    try {
      const { data, error } = await db()
        .from('enrollments')
        .select(
          'id,student_id,term_id,profiles(display_name,email,student_number),terms(name)',
        )
        .eq('subject_id', subjectId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const roster = ((data || []) as unknown as SubjectStudent[]).sort(
        (a, b) =>
          (a.profiles?.display_name || '').localeCompare(
            b.profiles?.display_name || '',
          ),
      );

      setSubjectStudents(roster);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSubjectStudentsBusy(false);
    }
  }

  async function toggleSubjectQuestions(subjectId: string) {
    if (expandedSubjectQuestions === subjectId) {
      setExpandedSubjectQuestions('');
      setSubjectQuestions([]);
      setSubjectQuestionSearch('');
      setSubjectQuestionImportOpen(false);
      return;
    }

    setExpandedSubjectQuestions(subjectId);
    setSubjectQuestions([]);
    setSubjectQuestionSearch('');
    setSubjectQuestionImportOpen(false);
    setSubjectQuestionsBusy(true);
    setMessage('');

    try {
      const { data, error } = await db()
        .from('questions')
        .select('id,data,is_active')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSubjectQuestions((data || []) as SubjectQuestion[]);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSubjectQuestionsBusy(false);
    }
  }

  useEffect(() => {
    if (
      tab !== 'Subjects' ||
      !expandedSubject ||
      !subjectEnrollOpen ||
      !subjectEnrollSearch.trim()
    ) {
      setSubjectEnrollResults([]);
      return;
    }

    let live = true;
    const timer = setTimeout(async () => {
      try {
        const clean = subjectEnrollSearch
          .trim()
          .replaceAll('%', '')
          .replaceAll('_', '')
          .replaceAll(',', '');

        const { data, error } = await db()
          .from('profiles')
          .select('id,display_name,email,student_number')
          .eq('role', 'student')
          .eq('is_active', true)
          .or(
            `display_name.ilike.%${clean}%,email.ilike.%${clean}%,student_number.ilike.%${clean}%`,
          )
          .order('display_name')
          .limit(10);

        if (error) throw error;

        if (live) {
          const alreadySelected = new Set(
            subjectEnrollSelected.map((student) => student.id),
          );
          setSubjectEnrollResults(
            ((data || []) as StudentOption[]).filter(
              (student) => !alreadySelected.has(student.id),
            ),
          );
        }
      } catch (error) {
        if (live) setMessage(errorText(error));
      }
    }, 180);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    tab,
    expandedSubject,
    subjectEnrollOpen,
    subjectEnrollSearch,
    subjectEnrollSelected,
  ]);

  function addSubjectEnrollmentStudent(student: StudentOption) {
    setSubjectEnrollSelected((current) =>
      current.some((item) => item.id === student.id)
        ? current
        : [...current, student],
    );
    setSubjectEnrollSearch('');
    setSubjectEnrollResults([]);
  }

  function removeSubjectEnrollmentStudent(studentId: string) {
    setSubjectEnrollSelected((current) =>
      current.filter((student) => student.id !== studentId),
    );
  }

  async function enrollStudentsInSubject() {
    if (!expandedSubject) return;

    if (!subjectEnrollTerm) {
      setMessage('Choose a school year / term first.');
      return;
    }

    if (!subjectEnrollSelected.length) {
      setMessage('Choose at least one student to enroll.');
      return;
    }

    setSubjectStudentsBusy(true);
    setMessage('');

    try {
      for (const student of subjectEnrollSelected) {
        const { data: existing, error: existingError } = await db()
          .from('enrollments')
          .select('id,is_active')
          .eq('student_id', student.id)
          .eq('subject_id', expandedSubject)
          .eq('term_id', subjectEnrollTerm)
          .maybeSingle();

        if (existingError) throw existingError;

        if (existing) {
          if (!existing.is_active) {
            const { error } = await db()
              .from('enrollments')
              .update({ is_active: true })
              .eq('id', existing.id);
            if (error) throw error;
          }
        } else {
          const { error } = await db().from('enrollments').insert({
            student_id: student.id,
            subject_id: expandedSubject,
            term_id: subjectEnrollTerm,
            is_active: true,
          });
          if (error) throw error;
        }
      }

      const count = subjectEnrollSelected.length;
      setSubjectEnrollOpen(false);
      setSubjectEnrollSearch('');
      setSubjectEnrollResults([]);
      setSubjectEnrollSelected([]);
      setSubjectEnrollTerm('');
      setMessage(
        `${count} student${count === 1 ? '' : 's'} enrolled in this subject.`,
      );

      // Refresh this subject roster immediately.
      const subjectId = expandedSubject;
      setExpandedSubject('');
      await toggleSubjectStudents(subjectId);
      reload();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSubjectStudentsBusy(false);
    }
  }

  async function removeStudentFromSubject(enrollmentId: string) {
    if (
      !confirm(
        'Remove this student from the subject for this school year / term? Their past attempt history will remain.',
      )
    ) {
      return;
    }

    setSubjectStudentsBusy(true);
    setMessage('');

    try {
      const { error } = await db()
        .from('enrollments')
        .update({ is_active: false })
        .eq('id', enrollmentId);

      if (error) throw error;

      setSubjectStudents((current) =>
        current.filter((student) => student.id !== enrollmentId),
      );
      setMessage('Student removed from this subject.');
      reload();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSubjectStudentsBusy(false);
    }
  }


  const visibleSubjectQuestions = subjectQuestions.filter((question) => {
    const query = subjectQuestionSearch.trim().toLowerCase();
    if (!query) return true;

    return (question.data?.text || '').toLowerCase().includes(query);
  });

  function buildExportSheet(
    title: string,
    headers: string[],
    rows: (string | number | boolean)[][],
    widths: number[],
  ) {
    const generated = new Date().toLocaleString();
    const worksheet = XLSX.utils.aoa_to_sheet([
      [title],
      [`Generated: ${generated}`],
      [],
      headers,
      ...rows,
    ]);

    worksheet['!merges'] = [
      XLSX.utils.decode_range(`A1:${XLSX.utils.encode_col(headers.length - 1)}1`),
      XLSX.utils.decode_range(`A2:${XLSX.utils.encode_col(headers.length - 1)}2`),
    ];

    worksheet['!cols'] = widths.map((wch) => ({ wch }));
    worksheet['!autofilter'] = {
      ref: `A4:${XLSX.utils.encode_col(headers.length - 1)}${rows.length + 4}`,
    };

    // SheetJS CE supports workbook structure/column sizing reliably.
    // Keep the sheet clean and readable without relying on unsupported styling.
    (worksheet as XLSX.WorkSheet & { '!freeze'?: unknown })['!freeze'] = {
      xSplit: 0,
      ySplit: 4,
      topLeftCell: 'A5',
      activePane: 'bottomLeft',
      state: 'frozen',
    };

    return worksheet;
  }

  async function exportRows() {
    setBusy(true);
    setMessage('');

    try {
      if (tab === 'Students') {
        const students: Row[] = [];

        for (let currentPage = 0; ; currentPage += 1) {
          let query = db()
            .from('profiles')
            .select('*')
            .eq('role', 'student')
            .order('display_name')
            .range(currentPage * 500, currentPage * 500 + 499);

          if (term) query = query.eq('term_id', term);

          const { data, error } = await query;
          if (error) throw error;

          students.push(...((data || []) as Row[]));
          if ((data || []).length < 500) break;
        }

        const studentIds = students
          .map((student) => student.id)
          .filter((id): id is string => !!id);

        type StudentEnrollmentExport = {
          student_id: string;
          term_id?: string;
          subjects?: { name?: string; code?: string } | null;
          terms?: { name?: string } | null;
        };

        const enrollments: StudentEnrollmentExport[] = [];

        for (let index = 0; index < studentIds.length; index += 300) {
          const ids = studentIds.slice(index, index + 300);
          if (!ids.length) continue;

          const { data, error } = await db()
            .from('enrollments')
            .select(
              'student_id,term_id,subjects(name,code),terms(name)',
            )
            .in('student_id', ids)
            .eq('is_active', true);

          if (error) throw error;
          enrollments.push(
            ...((data || []) as unknown as StudentEnrollmentExport[]),
          );
        }

        const enrollmentMap = new Map<string, StudentEnrollmentExport[]>();

        for (const enrollment of enrollments) {
          const list = enrollmentMap.get(enrollment.student_id) || [];
          list.push(enrollment);
          enrollmentMap.set(enrollment.student_id, list);
        }

        const studentRows = students.map((student) => {
          const studentEnrollments = student.id
            ? enrollmentMap.get(student.id) || []
            : [];

          const termNames = Array.from(
            new Set(
              studentEnrollments
                .map((item) => item.terms?.name)
                .filter((value): value is string => !!value),
            ),
          ).sort();

          const subjectNames = Array.from(
            new Set(
              studentEnrollments
                .map((item) => {
                  const name = item.subjects?.name?.trim();
                  const code = item.subjects?.code?.trim();

                  if (!name && !code) return '';
                  if (name && code) return `${name} (${code})`;
                  return name || code || '';
                })
                .filter(Boolean),
            ),
          ).sort();

          const fallbackTerm =
            termOptions.find((option) => option.id === student.term_id)?.name ||
            '';

          return [
            student.display_name || '',
            student.student_number || '',
            student.email || '',
            termNames.join('; ') || fallbackTerm,
            subjectNames.join('; '),
            student.is_active ? 'Active' : 'Inactive',
          ];
        });

        const enrollmentDetailRows = enrollments
          .map((enrollment) => {
            const student = students.find(
              (item) => item.id === enrollment.student_id,
            );

            return [
              student?.display_name || '',
              student?.student_number || '',
              student?.email || '',
              enrollment.terms?.name || '',
              enrollment.subjects?.name || '',
              enrollment.subjects?.code || '',
            ];
          })
          .sort((a, b) =>
            String(a[0]).localeCompare(String(b[0])),
          );

        const workbook = XLSX.utils.book_new();

        XLSX.utils.book_append_sheet(
          workbook,
          buildExportSheet(
            'MasteryHub Review — Students Export',
            [
              'Full Name',
              'Student Number',
              'Email',
              'School Year / Term',
              'Enrolled Subjects',
              'Status',
            ],
            studentRows,
            [28, 18, 32, 24, 48, 12],
          ),
          'Students',
        );

        XLSX.utils.book_append_sheet(
          workbook,
          buildExportSheet(
            'MasteryHub Review — Student Enrollments',
            [
              'Student Name',
              'Student Number',
              'Email',
              'School Year / Term',
              'Subject',
              'Subject Code',
            ],
            enrollmentDetailRows,
            [28, 18, 32, 24, 28, 16],
          ),
          'Enrollments',
        );

        XLSX.writeFile(workbook, 'masteryhub-students-export.xlsx');

        setMessage(
          `Exported ${students.length} student${
            students.length === 1 ? '' : 's'
          } with subject enrollment details.`,
        );

        return;
      }

      if (tab === 'Subjects') {
        const subjects: Row[] = [];

        for (let currentPage = 0; ; currentPage += 1) {
          const { data, error } = await db()
            .from('subjects')
            .select('*')
            .order('name')
            .range(currentPage * 500, currentPage * 500 + 499);

          if (error) throw error;

          subjects.push(...((data || []) as Row[]));
          if ((data || []).length < 500) break;
        }

        const subjectIds = subjects
          .map((subject) => subject.id)
          .filter((id): id is string => !!id);

        type SubjectEnrollmentExport = {
          subject_id: string;
          profiles?: {
            display_name?: string;
            student_number?: string;
            email?: string;
          } | null;
          terms?: { name?: string } | null;
        };

        const enrollments: SubjectEnrollmentExport[] = [];

        for (let index = 0; index < subjectIds.length; index += 300) {
          const ids = subjectIds.slice(index, index + 300);
          if (!ids.length) continue;

          const { data, error } = await db()
            .from('enrollments')
            .select(
              'subject_id,profiles(display_name,student_number,email),terms(name)',
            )
            .in('subject_id', ids)
            .eq('is_active', true);

          if (error) throw error;
          enrollments.push(
            ...((data || []) as unknown as SubjectEnrollmentExport[]),
          );
        }

        const enrollmentMap = new Map<string, SubjectEnrollmentExport[]>();

        for (const enrollment of enrollments) {
          const list = enrollmentMap.get(enrollment.subject_id) || [];
          list.push(enrollment);
          enrollmentMap.set(enrollment.subject_id, list);
        }

        const subjectRows = subjects.map((subject) => {
          const roster = subject.id
            ? enrollmentMap.get(subject.id) || []
            : [];

          const studentLabels = roster
            .map((item) => {
              const name = item.profiles?.display_name?.trim() || 'Student';
              const number =
                item.profiles?.student_number?.trim() ||
                item.profiles?.email?.trim() ||
                '';
              const termName = item.terms?.name?.trim() || '';

              const identity = number ? `${name} — ${number}` : name;
              return termName ? `${identity} (${termName})` : identity;
            })
            .sort();

          return [
            subject.name || '',
            subject.code || '',
            subject.description || '',
            roster.length,
            studentLabels.join('; '),
            subject.is_active ? 'Active' : 'Inactive',
          ];
        });

        const rosterRows = enrollments
          .map((enrollment) => {
            const subject = subjects.find(
              (item) => item.id === enrollment.subject_id,
            );

            return [
              subject?.name || '',
              subject?.code || '',
              enrollment.profiles?.display_name || '',
              enrollment.profiles?.student_number || '',
              enrollment.profiles?.email || '',
              enrollment.terms?.name || '',
            ];
          })
          .sort((a, b) => {
            const subjectCompare = String(a[0]).localeCompare(String(b[0]));
            if (subjectCompare !== 0) return subjectCompare;
            return String(a[2]).localeCompare(String(b[2]));
          });

        const workbook = XLSX.utils.book_new();

        XLSX.utils.book_append_sheet(
          workbook,
          buildExportSheet(
            'MasteryHub Review — Subjects Export',
            [
              'Subject Name',
              'Subject Code',
              'Description',
              'Enrolled Students',
              'Student List',
              'Status',
            ],
            subjectRows,
            [28, 16, 42, 18, 65, 12],
          ),
          'Subjects',
        );

        XLSX.utils.book_append_sheet(
          workbook,
          buildExportSheet(
            'MasteryHub Review — Subject Rosters',
            [
              'Subject Name',
              'Subject Code',
              'Student Name',
              'Student Number',
              'Email',
              'School Year / Term',
            ],
            rosterRows,
            [28, 16, 28, 18, 32, 24],
          ),
          'Subject Rosters',
        );

        XLSX.writeFile(workbook, 'masteryhub-subjects-export.xlsx');

        setMessage(
          `Exported ${subjects.length} subject${
            subjects.length === 1 ? '' : 's'
          } with enrolled student details.`,
        );

        return;
      }

      setMessage('Nothing to export from this page.');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const visibleSubjectStudents = subjectRosterTerm
    ? subjectStudents.filter(
        (student) => student.term_id === subjectRosterTerm,
      )
    : subjectStudents;

  const addLabel =
    tab === 'Enrollment'
      ? 'enrollment'
      : tab.toLowerCase().replace(/s$/, '');

  return (
    <div className="records-page">
      <div className="page-heading admin-record-heading">
        <div>
          <span className="eyebrow">WORKSPACE MANAGEMENT</span>
          <h1>{tab}</h1>
          <p>
            {tab === 'Students'
              ? 'Individual accounts. Carefully controlled access.'
              : tab === 'Enrollment'
                ? 'Connect students with subjects for a specific school term.'
                : 'Keep your academic library organized.'}
          </p>
        </div>

        <div className="actions admin-record-actions">
          <button className="ghost" disabled={busy} onClick={exportRows}>
            Export records
          </button>

          {tab === 'Students' && (
            <div className="admin-import-wrap">
              <button
                className="ghost"
                type="button"
                onClick={() => setImports((value) => !value)}
              >
                {imports ? '− Close import' : 'Import students'}
              </button>

              {imports && (
                <section className="panel admin-action-popover admin-import-popover">
                  <button
                    type="button"
                    className="admin-action-popover-header"
                    onClick={() => setImports(false)}
                    aria-expanded="true"
                  >
                    <span>
                      <span className="eyebrow">IMPORT</span>
                      <strong>Import students</strong>
                    </span>
                    <span className="admin-editor-chevron">−</span>
                  </button>

                  <div className="admin-action-popover-body">
                    <ImportPanel kind="students" onDone={() => {
                      reload();
                      setImports(false);
                    }} />
                  </div>
                </section>
              )}
            </div>
          )}

          <div className="admin-add-wrap">
            <button
              type="button"
              onClick={() => {
                setSelectedSubjects([]);
                setStudentSubjectSearch('');
                setSelectedEnrollmentStudents([]);
                setSelectedEnrollmentSubjects([]);
                setEnrollmentStudentSearch('');
                setEditing((current) =>
                  current?.id
                    ? { is_active: true }
                    : current
                      ? null
                      : { is_active: true },
                );
              }}
            >
              {editing && !editing.id
                ? `− Close add ${addLabel}`
                : `+ Add ${addLabel}`}
            </button>

            {editing && !editing.id && (
              <section className="panel editor admin-compact-editor admin-add-popover">
                <button
                  type="button"
                  className="admin-editor-toggle"
                  onClick={() => setEditing(null)}
                  aria-expanded="true"
                >
                  <span>
                    <span className="eyebrow">NEW RECORD</span>
                    <strong>{`Add ${addLabel}`}</strong>
                  </span>

                  <span className="admin-editor-chevron">−</span>
                </button>

                <form className="stack admin-record-form" onSubmit={save}>
                  {table === 'profiles' ? (
                    <>
                      <label>
                        Display name
                        <input
                          required
                          value={editing.display_name || ''}
                          onChange={(event) =>
                            field('display_name', event.target.value)
                          }
                        />
                      </label>

                      <label>
                        Email
                        <input
                          required
                          type="email"
                          value={editing.email || ''}
                          onChange={(event) =>
                            field('email', event.target.value)
                          }
                        />
                      </label>

                      <div className="admin-form-grid">
                        <label>
                          Student number
                          <input
                            value={editing.student_number || ''}
                            onChange={(event) =>
                              field('student_number', event.target.value)
                            }
                          />
                        </label>

                        <label>
                          Temporary password
                          <input
                            type="password"
                            autoComplete="new-password"
                            minLength={12}
                            required
                            value={editing.password || ''}
                            onChange={(event) =>
                              field('password', event.target.value)
                            }
                          />
                        </label>
                      </div>

                      <RemoteSelect
                        table="terms"
                        label="School year / semester"
                        value={editing.term_id || ''}
                        onChange={(value) => {
                          field('term_id', value);
                          setSelectedSubjects([]);
                          setStudentSubjectSearch('');
                        }}
                      />

                      <fieldset className="student-subject-picker student-subject-search-picker">
                        <legend>Enroll in subjects</legend>
                        <p>
                          Optional. Search by subject name or code, then press Enter or
                          Search. Each selected subject will be added below.
                        </p>

                        <div className="student-subject-search-row">
                          <input
                            type="search"
                            placeholder="Search subject name or code"
                            value={studentSubjectSearch}
                            onChange={(event) =>
                              setStudentSubjectSearch(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                addStudentSubject();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="ghost"
                            disabled={!subjectOptions.length}
                            onClick={() => addStudentSubject()}
                          >
                            Search
                          </button>
                        </div>

                        {!!studentSubjectSearch.trim() && (
                          <div className="student-subject-search-results">
                            {getStudentSubjectMatches().length ? (
                              getStudentSubjectMatches().map((subject) => (
                                <div
                                  key={subject.id}
                                  className="student-subject-result-row"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => addStudentSubject(subject)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      addStudentSubject(subject);
                                    }
                                  }}
                                >
                                  <span>
                                    <strong>{subject.name}</strong>
                                    {subject.code ? (
                                      <small>{subject.code}</small>
                                    ) : null}
                                  </span>
                                  <span className="student-subject-add-hint">
                                    Add
                                  </span>
                                </div>
                              ))
                            ) : (
                              <div className="student-subject-no-result">
                                No matching active subject.
                              </div>
                            )}
                          </div>
                        )}

                        {!subjectOptions.length && (
                          <span className="field-note">No active subjects yet.</span>
                        )}

                        {!!selectedSubjects.length && (
                          <div className="student-selected-subjects">
                            {selectedSubjects.map((subjectId) => {
                              const subject = subjectOptions.find(
                                (item) => item.id === subjectId,
                              );
                              if (!subject) return null;

                              return (
                                <span key={subject.id}>
                                  <strong>{subject.name}</strong>
                                  {subject.code ? <small>{subject.code}</small> : null}
                                  <span
                                    className="student-subject-remove-x"
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Remove ${subject.name}`}
                                    title="Remove subject"
                                    onClick={() => removeStudentSubject(subject.id)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        removeStudentSubject(subject.id);
                                      }
                                    }}
                                  >
                                    ×
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </fieldset>
                    </>
                  ) : table === 'enrollments' ? (
                    <>
                      <div className="enrollment-student-picker">
                        <label htmlFor="enrollment-student-search">Students</label>
                        <input
                          id="enrollment-student-search"
                          type="search"
                          placeholder="Search name, email, or student number"
                          value={enrollmentStudentSearch}
                          onChange={(event) => setEnrollmentStudentSearch(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              if (enrollmentStudentResults[0]) {
                                addEnrollmentStudent(enrollmentStudentResults[0]);
                              }
                            }
                          }}
                        />
                        <small>Type a student, press Enter to add, then search for another.</small>

                        {!!enrollmentStudentResults.length && (
                          <div className="enrollment-search-results">
                            {enrollmentStudentResults.map((student) => (
                              <button
                                key={student.id}
                                type="button"
                                onClick={() => addEnrollmentStudent(student)}
                              >
                                <strong>{student.display_name}</strong>
                                <span>{student.student_number || student.email || ''}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {!!selectedEnrollmentStudents.length && (
                          <div className="selected-student-chips">
                            {selectedEnrollmentStudents.map((student) => (
                              <button
                                key={student.id}
                                type="button"
                                onClick={() => removeEnrollmentStudent(student.id)}
                                title="Remove student"
                              >
                                {student.display_name}<span aria-hidden="true"> ×</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <fieldset className="student-subject-picker enrollment-subject-picker">
                        <legend>Subjects</legend>
                        <p>Select one or more subjects for the selected students.</p>
                        <div className="student-subject-grid">
                          {subjectOptions.map((subject) => (
                            <label key={subject.id} className="student-subject-option">
                              <input
                                type="checkbox"
                                checked={selectedEnrollmentSubjects.includes(subject.id)}
                                onChange={() => toggleEnrollmentSubject(subject.id)}
                              />
                              <span>
                                {subject.name}
                                {subject.code ? <small> — {subject.code}</small> : null}
                              </span>
                            </label>
                          ))}
                          {!subjectOptions.length && (
                            <span className="field-note">No active subjects yet.</span>
                          )}
                        </div>
                      </fieldset>

                      <RemoteSelect
                        table="terms"
                        label="School year / semester"
                        value={editing.term_id || ''}
                        onChange={(value) => field('term_id', value)}
                      />
                    </>
                  ) : (
                    <>
                      <label>
                        Name
                        <input
                          required
                          value={editing.name || ''}
                          onChange={(event) =>
                            field('name', event.target.value)
                          }
                        />
                      </label>

                      {table === 'subjects' && (
                        <>
                          <label>
                            Subject code
                            <input
                              value={editing.code || ''}
                              onChange={(event) =>
                                field('code', event.target.value)
                              }
                            />
                          </label>

                          <label>
                            Description
                            <textarea
                              value={editing.description || ''}
                              onChange={(event) =>
                                field('description', event.target.value)
                              }
                            />
                          </label>
                        </>
                      )}
                    </>
                  )}

                  <div className="admin-form-footer">
                    <Check
                      label="Active"
                      checked={editing.is_active}
                      onChange={(value) => field('is_active', value)}
                    />

                    <div className="actions">
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>

                      <button disabled={busy}>
                        {busy ? 'Saving…' : 'Save record'}
                      </button>
                    </div>
                  </div>
                </form>
              </section>
            )}
          </div>
        </div>
      </div>

      <Notice message={message} />

      {tab === 'Students' && (
        <div className="toolbar admin-record-toolbar">
          <div className="admin-filter-field admin-filter-search">
            <label htmlFor="student-search">Search</label>
            <input
              id="student-search"
              type="search"
              placeholder="Search by name"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </div>

          <div className="admin-filter-field">
            <label htmlFor="student-term-filter">School year / semester</label>
            <select
              id="student-term-filter"
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                setPage(0);
              }}
            >
              <option value="">All terms</option>
              {termOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>

          <button
            className="ghost admin-filter-action"
            type="button"
            disabled={!term}
            onClick={() => {
              setTerm('');
              setPage(0);
            }}
          >
            Clear filter
          </button>

          {term && (
            <button
              className="danger admin-filter-action"
              disabled={busy}
              type="button"
              onClick={async () => {
                if (
                  !confirm(
                    'Deactivate every student in this term? Accounts and history will remain stored.',
                  )
                ) {
                  return;
                }

                setBusy(true);

                const { error } = await db()
                  .from('profiles')
                  .update({ is_active: false })
                  .eq('role', 'student')
                  .eq('term_id', term);

                setMessage(
                  error ? error.message : 'Term students deactivated.',
                );
                setBusy(false);
                reload();
              }}
            >
              Deactivate term
            </button>
          )}
        </div>
      )}

      {table !== 'profiles' && table !== 'enrollments' && (
        <div className="toolbar admin-record-toolbar admin-simple-search">
          <div className="admin-filter-field admin-filter-search">
            <label htmlFor={`${table}-search`}>Search</label>
            <input
              id={`${table}-search`}
              type="search"
              placeholder="Search by name"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
      )}


      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>{tab === 'Enrollment' ? 'Student' : 'Name'}</th>
              <th>
                {tab === 'Students'
                  ? 'Email / Student number'
                  : tab === 'Enrollment'
                    ? 'Subject / Term'
                    : 'Code / Details'}
              </th>
              <th>Status</th>
              <th>Manage</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const isEditing = editing?.id === row.id;

              return (
                <Fragment key={row.id}>
                  <tr className={isEditing ? 'record-row editing' : 'record-row'}>
                    <td>
                      {tab === 'Subjects' && row.id ? (
                        <button
                          type="button"
                          className="subject-roster-trigger"
                          onClick={() => toggleSubjectStudents(row.id!)}
                          aria-expanded={expandedSubject === row.id}
                        >
                          <span>{row.name || 'Untitled subject'}</span>
                          <small>
                            {expandedSubject === row.id
                              ? 'Hide enrolled students'
                              : 'View enrolled students'}
                          </small>
                        </button>
                      ) : (
                        row.display_name ||
                        row.name ||
                        row.profiles?.display_name
                      )}
                    </td>

                    <td>
                      {row.email ? (
                        <>
                          {row.email}
                          <small>{row.student_number}</small>
                        </>
                      ) : row.subjects ? (
                        <>
                          {row.subjects.name}
                          <small>{row.terms?.name}</small>
                        </>
                      ) : (
                        row.code || row.description || '-'
                      )}
                    </td>

                    <td>
                      <span
                        className={`pill ${!row.is_active ? 'muted' : ''}`}
                      >
                        {row.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    <td>
                      <div className="actions">
                        {tab === 'Subjects' && row.id && (
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => toggleSubjectQuestions(row.id!)}
                          >
                            {expandedSubjectQuestions === row.id
                              ? 'Close Questions'
                              : 'Questions'}
                          </button>
                        )}

                        <button
                          className="ghost"
                          type="button"
                          onClick={() => {
                            setSelectedSubjects([]);
                            setSelectedEnrollmentSubjects([]);
                            setSelectedEnrollmentStudents([]);
                            setEnrollmentStudentSearch('');
                            setEditing((current) =>
                              current?.id === row.id ? null : row,
                            );
                          }}
                        >
                          {isEditing ? 'Close' : 'Edit'}
                        </button>

                        {tab === 'Terms' && row.id && (
                          <button
                            className="danger"
                            disabled={busy}
                            type="button"
                            onClick={async () => {
                              const termName = row.name || 'this school term';

                              if (
                                !confirm(
                                  `Delete "${termName}"? This will permanently delete this school term and remove its term assignment from affected student profiles. Student accounts will remain. This cannot be undone.`,
                                )
                              ) {
                                return;
                              }

                              setBusy(true);
                              setMessage('');

                              try {
                                const { error } = await db().rpc('delete_term', {
                                  target_term_id: row.id,
                                });

                                if (error) throw error;

                                if (editing?.id === row.id) {
                                  setEditing(null);
                                }

                                setMessage(`School term "${termName}" deleted.`);
                                reload();
                              } catch (error) {
                                setMessage(errorText(error));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Delete
                          </button>
                        )}

                        {tab === 'Subjects' && row.id && (
                          <button
                            className="danger"
                            disabled={busy}
                            type="button"
                            onClick={async () => {
                              const subjectName = row.name || 'this subject';

                              if (
                                !confirm(
                                  `Delete "${subjectName}"? This will permanently delete this subject and its subject-linked records. Student accounts will remain. This cannot be undone.`,
                                )
                              ) {
                                return;
                              }

                              setBusy(true);
                              setMessage('');

                              try {
                                const { error } = await db().rpc('delete_subject', {
                                  target_subject_id: row.id,
                                });

                                if (error) throw error;

                                if (editing?.id === row.id) setEditing(null);
                                if (expandedSubject === row.id) {
                                  setExpandedSubject('');
                                  setSubjectStudents([]);
                                }
                                if (expandedSubjectQuestions === row.id) {
                                  setExpandedSubjectQuestions('');
                                  setSubjectQuestions([]);
                                }

                                setMessage(`Subject "${subjectName}" deleted.`);
                                reload();
                              } catch (error) {
                                setMessage(errorText(error));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Delete
                          </button>
                        )}

                        {tab === 'Students' && (
                          <button
                            className="danger"
                            disabled={busy}
                            type="button"
                            onClick={async () => {
                              if (
                                !confirm(
                                  'Have you exported and verified a backup? Delete this student only if no attempt history exists.',
                                )
                              ) {
                                return;
                              }

                              setBusy(true);

                              try {
                                await adminAccount({
                                  action: 'delete',
                                  id: row.id,
                                  backup_verified: true,
                                });

                                reload();
                                setMessage('Student removed.');
                              } catch (error) {
                                setMessage(errorText(error));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {tab === 'Subjects' &&
                    expandedSubject === row.id && (
                      <tr className="subject-roster-row">
                        <td colSpan={4}>
                          <section className="subject-roster-panel">
                            <div className="subject-roster-heading">
                              <div>
                                <strong>{row.name}</strong>
                                <span>
                                  {subjectStudentsBusy
                                    ? 'Loading students…'
                                    : `${visibleSubjectStudents.length} shown · ${subjectStudents.length} active enrollment${
                                        subjectStudents.length === 1 ? '' : 's'
                                      } total`}
                                </span>
                              </div>

                              <div className="subject-roster-heading-actions">
                                <label className="subject-roster-term-filter">
                                  <span>School year / term</span>
                                  <select
                                    value={subjectRosterTerm}
                                    onChange={(event) =>
                                      setSubjectRosterTerm(event.target.value)
                                    }
                                  >
                                    <option value="">All terms</option>
                                    {termOptions.map((option) => (
                                      <option key={option.id} value={option.id}>
                                        {option.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>


                              </div>

                              <button
                                type="button"
                                className="subject-roster-enroll-toggle"
                                onClick={() => {
                                  setSubjectEnrollOpen((value) => !value);
                                  setSubjectEnrollSearch('');
                                  setSubjectEnrollResults([]);
                                  setSubjectEnrollSelected([]);
                                  setSubjectEnrollTerm('');
                                }}
                              >
                                {subjectEnrollOpen ? '− Close enroll' : '+ Enroll students'}
                              </button>
                            </div>

                            {subjectEnrollOpen && (
                              <div className="subject-roster-enroll-card">
                                <div className="subject-roster-enroll-grid">
                                  <label>
                                    School year / term
                                    <select
                                      value={subjectEnrollTerm}
                                      onChange={(event) =>
                                        setSubjectEnrollTerm(event.target.value)
                                      }
                                    >
                                      <option value="">Choose term</option>
                                      {termOptions.map((option) => (
                                        <option key={option.id} value={option.id}>
                                          {option.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>

                                  <label>
                                    Find existing students
                                    <input
                                      type="search"
                                      value={subjectEnrollSearch}
                                      placeholder="Name, email, or student number"
                                      onChange={(event) =>
                                        setSubjectEnrollSearch(event.target.value)
                                      }
                                    />
                                  </label>
                                </div>

                                {!!subjectEnrollResults.length && (
                                  <div className="subject-enroll-search-results">
                                    {subjectEnrollResults.map((student) => (
                                      <button
                                        type="button"
                                        key={student.id}
                                        onClick={() =>
                                          addSubjectEnrollmentStudent(student)
                                        }
                                      >
                                        <strong>{student.display_name}</strong>
                                        <span>
                                          {student.student_number ||
                                            student.email ||
                                            'Student'}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}

                                {!!subjectEnrollSelected.length && (
                                  <div className="subject-enroll-selected">
                                    {subjectEnrollSelected.map((student) => (
                                      <span key={student.id}>
                                        {student.display_name}
                                        <button
                                          type="button"
                                          aria-label={`Remove ${student.display_name}`}
                                          onClick={() =>
                                            removeSubjectEnrollmentStudent(student.id)
                                          }
                                        >
                                          ×
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                )}

                                <div className="actions">
                                  <button
                                    type="button"
                                    disabled={
                                      subjectStudentsBusy ||
                                      !subjectEnrollTerm ||
                                      !subjectEnrollSelected.length
                                    }
                                    onClick={enrollStudentsInSubject}
                                  >
                                    {subjectStudentsBusy
                                      ? 'Enrolling...'
                                      : `Enroll ${
                                          subjectEnrollSelected.length || ''
                                        } student${
                                          subjectEnrollSelected.length === 1
                                            ? ''
                                            : 's'
                                        }`}
                                  </button>
                                </div>
                              </div>
                            )}

                            {subjectStudentsBusy ? (
                              <p className="subject-roster-empty">
                                Loading enrolled students…
                              </p>
                            ) : visibleSubjectStudents.length ? (
                              <div className="subject-roster-list">
                                {visibleSubjectStudents.map((student) => (
                                  <div
                                    className="subject-roster-student"
                                    key={student.id}
                                  >
                                    <div>
                                      <strong>
                                        {student.profiles?.display_name ||
                                          'Student'}
                                      </strong>
                                      <small>
                                        {student.profiles?.student_number ||
                                          student.profiles?.email ||
                                          'No student number'}
                                      </small>
                                    </div>

                                    <div className="subject-roster-student-actions">
                                      <span>
                                        {student.terms?.name || 'No term'}
                                      </span>

                                      <button
                                        type="button"
                                        className="subject-roster-remove"
                                        disabled={subjectStudentsBusy}
                                        onClick={() =>
                                          removeStudentFromSubject(student.id)
                                        }
                                        aria-label={`Remove ${
                                          student.profiles?.display_name ||
                                          'student'
                                        } from subject`}
                                        title="Remove from subject"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="subject-roster-empty">
                                {subjectStudents.length
                                  ? 'No enrolled students found for this school year / term.'
                                  : 'No active students are currently enrolled in this subject.'}
                              </p>
                            )}
                          </section>
                        </td>
                      </tr>
                    )}

                  {tab === 'Subjects' &&
                    expandedSubjectQuestions === row.id && (
                      <tr className="subject-questions-row">
                        <td colSpan={4}>
                          <section className="subject-questions-panel">
                            <div className="subject-questions-heading">
                              <div>
                                <strong>{row.name} Questions</strong>
                                <span>
                                  {subjectQuestionsBusy
                                    ? 'Loading questions…'
                                    : `${subjectQuestions.length} question${
                                        subjectQuestions.length === 1 ? '' : 's'
                                      }`}
                                </span>
                              </div>

                              <div className="subject-questions-heading-actions">
                                <input
                                  type="search"
                                  placeholder="Search questions"
                                  value={subjectQuestionSearch}
                                  onChange={(event) =>
                                    setSubjectQuestionSearch(event.target.value)
                                  }
                                />

                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() =>
                                    setSubjectQuestionImportOpen((value) => !value)
                                  }
                                >
                                  {subjectQuestionImportOpen
                                    ? 'Close import'
                                    : 'Import questions'}
                                </button>
                              </div>
                            </div>

                            {subjectQuestionImportOpen && (
                              <div className="subject-question-import-wrap">
                                <ImportPanel
                                  kind="questions"
                                  questionSubjectId={row.id}
                                  onDone={async () => {
                                    setSubjectQuestionImportOpen(false);
                                    setExpandedSubjectQuestions('');
                                    await toggleSubjectQuestions(row.id!);
                                  }}
                                />
                              </div>
                            )}

                            {subjectQuestionsBusy ? (
                              <p className="subject-roster-empty">
                                Loading questions…
                              </p>
                            ) : visibleSubjectQuestions.length ? (
                              <div className="subject-question-list">
                                {visibleSubjectQuestions.map((question, index) => (
                                  <div
                                    className="subject-question-item"
                                    key={question.id}
                                  >
                                    <span className="subject-question-number">
                                      {index + 1}
                                    </span>

                                    <div>
                                      <strong>
                                        {question.data?.text || 'Untitled question'}
                                      </strong>
                                      <small>
                                        {question.is_active ? 'Active' : 'Inactive'}
                                        {question.data?.points
                                          ? ` · ${question.data.points} point${
                                              question.data.points === 1 ? '' : 's'
                                            }`
                                          : ''}
                                      </small>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="subject-roster-empty">
                                {subjectQuestions.length
                                  ? 'No questions match this search.'
                                  : 'No questions have been added to this subject yet.'}
                              </p>
                            )}
                          </section>
                        </td>
                      </tr>
                    )}

                  {isEditing && editing && (
                    <tr className="record-edit-row">
                      <td colSpan={4}>
                        <form
                          className="record-inline-editor"
                          onSubmit={save}
                        >
                          {table === 'profiles' ? (
                            <>
                              <label>
                                Display name
                                <input
                                  required
                                  value={editing.display_name || ''}
                                  onChange={(event) =>
                                    field('display_name', event.target.value)
                                  }
                                />
                              </label>

                              <label>
                                Email
                                <input
                                  required
                                  type="email"
                                  value={editing.email || ''}
                                  onChange={(event) =>
                                    field('email', event.target.value)
                                  }
                                />
                              </label>

                              <label>
                                New password
                                <span className="field-note"> optional</span>
                                <input
                                  type="password"
                                  autoComplete="new-password"
                                  minLength={12}
                                  value={editing.password || ''}
                                  onChange={(event) =>
                                    field('password', event.target.value)
                                  }
                                />
                              </label>

                              <label>
                                Student number
                                <input
                                  value={editing.student_number || ''}
                                  onChange={(event) =>
                                    field('student_number', event.target.value)
                                  }
                                />
                              </label>

                              <label>
                                School year / semester
                                <select
                                  value={editing.term_id || ''}
                                  onChange={(event) => {
                                    field('term_id', event.target.value);
                                    setSelectedSubjects([]);
                                  }}
                                >
                                  <option value="">No term selected</option>
                                  {termOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.name}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <fieldset className="student-subject-picker student-subject-search-picker record-inline-wide">
                                <legend>Subjects</legend>
                                <p>
                                  Search by subject name or code, then press Enter or Search.
                                </p>

                                <div className="student-subject-search-row">
                                  <input
                                    type="search"
                                    placeholder="Search subject name or code"
                                    value={studentSubjectSearch}
                                    onChange={(event) =>
                                      setStudentSubjectSearch(event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addStudentSubject();
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="ghost"
                                    disabled={!subjectOptions.length}
                                    onClick={() => addStudentSubject()}
                                  >
                                    Search
                                  </button>
                                </div>

                                {!!studentSubjectSearch.trim() && (
                                  <div className="student-subject-search-results">
                                    {getStudentSubjectMatches().length ? (
                                      getStudentSubjectMatches().map((subject) => (
                                        <div
                                          key={subject.id}
                                          className="student-subject-result-row"
                                          role="button"
                                          tabIndex={0}
                                          onClick={() => addStudentSubject(subject)}
                                          onKeyDown={(event) => {
                                            if (
                                              event.key === 'Enter' ||
                                              event.key === ' '
                                            ) {
                                              event.preventDefault();
                                              addStudentSubject(subject);
                                            }
                                          }}
                                        >
                                          <span>
                                            <strong>{subject.name}</strong>
                                            {subject.code ? (
                                              <small>{subject.code}</small>
                                            ) : null}
                                          </span>
                                          <span className="student-subject-add-hint">
                                            Add
                                          </span>
                                        </div>
                                      ))
                                    ) : (
                                      <div className="student-subject-no-result">
                                        No matching active subject.
                                      </div>
                                    )}
                                  </div>
                                )}

                                {!!selectedSubjects.length && (
                                  <div className="student-selected-subjects">
                                    {selectedSubjects.map((subjectId) => {
                                      const subject = subjectOptions.find(
                                        (item) => item.id === subjectId,
                                      );
                                      if (!subject) return null;

                                      return (
                                        <span key={subject.id}>
                                          <strong>{subject.name}</strong>
                                          {subject.code ? <small>{subject.code}</small> : null}
                                          <span
                                            className="student-subject-remove-x"
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`Remove ${subject.name}`}
                                            title="Remove subject"
                                            onClick={() =>
                                              removeStudentSubject(subject.id)
                                            }
                                            onKeyDown={(event) => {
                                              if (
                                                event.key === 'Enter' ||
                                                event.key === ' '
                                              ) {
                                                event.preventDefault();
                                                removeStudentSubject(subject.id);
                                              }
                                            }}
                                          >
                                            ×
                                          </span>
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              </fieldset>
                            </>
                          ) : table === 'enrollments' ? (
                            <>
                              <RemoteSelect
                                table="profiles"
                                label="Student"
                                studentsOnly
                                value={editing.student_id || ''}
                                onChange={(value) => {
                                  field('student_id', value);
                                  setSelectedEnrollmentSubjects([]);
                                }}
                              />

                              <RemoteSelect
                                table="terms"
                                label="School year / semester"
                                value={editing.term_id || ''}
                                onChange={(value) => {
                                  field('term_id', value);
                                  setSelectedEnrollmentSubjects([]);
                                }}
                              />

                              <fieldset className="student-subject-picker enrollment-subject-picker record-inline-wide">
                                <legend>Subjects</legend>
                                <div className="student-subject-grid">
                                  {subjectOptions.map((subject) => (
                                    <label
                                      key={subject.id}
                                      className="student-subject-option"
                                      title={subject.code ? `${subject.name} — ${subject.code}` : subject.name}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedEnrollmentSubjects.includes(subject.id)}
                                        onChange={() => toggleEnrollmentSubject(subject.id)}
                                      />
                                      <span>
                                        {subject.name}
                                        {subject.code ? <small> — {subject.code}</small> : null}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                            </>
                          ) : (
                            <>
                              <label>
                                Name
                                <input
                                  required
                                  value={editing.name || ''}
                                  onChange={(event) =>
                                    field('name', event.target.value)
                                  }
                                />
                              </label>

                              {table === 'subjects' && (
                                <>
                                  <label>
                                    Subject code
                                    <input
                                      value={editing.code || ''}
                                      onChange={(event) =>
                                        field('code', event.target.value)
                                      }
                                    />
                                  </label>

                                  <label className="record-inline-wide">
                                    Description
                                    <textarea
                                      value={editing.description || ''}
                                      onChange={(event) =>
                                        field('description', event.target.value)
                                      }
                                    />
                                  </label>
                                </>
                              )}
                            </>
                          )}

                          <div className="record-inline-active">
                            <Check
                              label="Active"
                              checked={editing.is_active}
                              onChange={(value) => field('is_active', value)}
                            />
                          </div>

                          <div className="record-inline-actions">
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </button>
                            <button className="ghost inline-save-action" disabled={busy}>
                              {busy ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {!rows.length && (
          <div className="empty">No records to display.</div>
        )}
      </div>

      <div className="records-pager-space">
        <Pager page={page} setPage={setPage} more={rows.length === 10} />
      </div>
    </div>
  );
}

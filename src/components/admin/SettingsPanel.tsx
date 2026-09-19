'use client';

import { useEffect, useState } from 'react';
import { db, rpc } from '@/lib/supabase';
import type { Branding } from '../Workspace';
import {
  ImageAttachment,
  Notice,
  uploadImage,
  errorText,
} from '../shared';
import Records from './Records';

type SettingsView = 'branding' | 'terms' | 'announcements' | 'reset';

type SubjectOption = {
  id: string;
  name: string;
  code: string;
};

const SETTINGS_TABS: {
  id: SettingsView;
  label: string;
  description: string;
}[] = [
  {
    id: 'branding',
    label: 'General',
    description: 'Branding & student content',
  },
  {
    id: 'announcements',
    label: 'Announcements',
    description: 'Send student updates',
  },
  {
    id: 'terms',
    label: 'School Terms',
    description: 'Years & semesters',
  },
  {
    id: 'reset',
    label: 'Reset Data',
    description: 'Clear student data',
  },
];

export default function SettingsPanel({
  branding,
  onBranding,
}: {
  branding: Branding;
  onBranding: (b: Branding) => void;
}) {
  const [draft, setDraft] = useState(branding);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<SettingsView>('branding');

  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [announcementTarget, setAnnouncementTarget] = useState<'all' | 'subject'>(
    'all',
  );
  const [announcementSubject, setAnnouncementSubject] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementMessage, setAnnouncementMessage] = useState('');

  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetResult, setResetResult] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    if (view !== 'announcements' || subjects.length) return;

    let live = true;

    (async () => {
      try {
        const { data, error } = await db()
          .from('subjects')
          .select('id,name,code')
          .eq('is_active', true)
          .order('name');

        if (error) throw error;

        if (live) {
          setSubjects((data || []) as SubjectOption[]);
        }
      } catch (error) {
        if (live) setMessage(errorText(error));
      }
    })();

    return () => {
      live = false;
    };
  }, [view, subjects.length]);

  function changeView(next: SettingsView) {
    setView(next);
    setMessage('');
  }

  async function resetStudentData() {
    if (resetConfirmation !== 'RESET DATA') return;

    const confirmed = window.confirm(
      'This will permanently delete all student accounts and operational student data. This action cannot be undone. Continue?',
    );

    if (!confirmed) return;

    setResetBusy(true);
    setResetResult('');
    setMessage('');

    try {
      const result = await rpc<{
        ok: boolean;
        students_deleted: number;
        attempts_deleted: number;
        enrollments_deleted: number;
        reviewer_assignments_deleted: number;
        announcements_deleted: number;
      }>('reset_student_data', {
        confirmation_text: resetConfirmation,
      });

      setResetResult(
        `Reset complete. ${result.students_deleted || 0} student account${
          result.students_deleted === 1 ? '' : 's'
        }, ${result.attempts_deleted || 0} attempt${
          result.attempts_deleted === 1 ? '' : 's'
        }, ${result.enrollments_deleted || 0} enrollment${
          result.enrollments_deleted === 1 ? '' : 's'
        }, and ${result.reviewer_assignments_deleted || 0} reviewer assignment${
          result.reviewer_assignments_deleted === 1 ? '' : 's'
        } deleted.`,
      );

      setResetConfirmation('');
    } catch (error) {
      setResetResult(errorText(error));
    } finally {
      setResetBusy(false);
    }
  }

  async function sendAnnouncement(event: React.FormEvent) {
    event.preventDefault();

    if (announcementTarget === 'subject' && !announcementSubject) {
      setMessage('Choose a subject first.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const recipientCount = await rpc<number>('send_announcement', {
        target_subject:
          announcementTarget === 'subject' ? announcementSubject : null,
        announcement_title: announcementTitle.trim(),
        announcement_message: announcementMessage.trim(),
      });

      setMessage(
        `Announcement sent to ${recipientCount} student${
          recipientCount === 1 ? '' : 's'
        }.`,
      );

      setAnnouncementTitle('');
      setAnnouncementMessage('');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-standard-page settings-modern-page">
      <div className="page-heading admin-page-heading settings-modern-heading">
        <div>
          <span className="eyebrow">SYSTEM CONTROL</span>
          <h1>Settings</h1>
          <p>
            Manage how MasteryHub looks, communicate with students, and organize
            academic terms.
          </p>
        </div>
      </div>

      <div className="settings-modern-tabs" role="tablist" aria-label="Settings">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            className={`settings-modern-tab ${
              view === tab.id ? 'active' : ''
            }`}
            onClick={() => changeView(tab.id)}
          >
            <span>{tab.label}</span>
            <small>{tab.description}</small>
          </button>
        ))}
      </div>

      {view === 'reset' ? (
        <section className="settings-modern-content">
          <div className="settings-section-intro">
            <div>
              <span className="eyebrow">DANGER ZONE</span>
              <h2>Reset student data</h2>
              <p>
                Clear student accounts and activity when preparing the system for
                a fresh batch or school period.
              </p>
            </div>
          </div>

          <div className="settings-card settings-danger-card">
            <div className="settings-card-heading">
              <div>
                <h3>Permanent data reset</h3>
                <p>
                  This action permanently removes student and operational data.
                  It cannot be undone.
                </p>
              </div>
              <span className="settings-danger-chip">Destructive</span>
            </div>

            <div className="settings-reset-summary">
              <div className="settings-reset-column">
                <strong>Will be deleted</strong>
                <ul>
                  <li>Student accounts and profiles</li>
                  <li>Subject enrollments</li>
                  <li>Reviewer-to-student assignments</li>
                  <li>Attempts, responses, scores, and grading records</li>
                  <li>Student notifications and device sessions</li>
                  <li>Announcements and student dismissals</li>
                </ul>
              </div>

              <div className="settings-reset-column keep">
                <strong>Will be kept</strong>
                <ul>
                  <li>Administrator account</li>
                  <li>System branding and settings</li>
                  <li>School terms / semesters</li>
                  <li>Subjects</li>
                  <li>Question bank</li>
                  <li>Reviewers and their configuration</li>
                </ul>
              </div>
            </div>

            <div className="settings-reset-confirmation">
              <div>
                <strong>Confirm reset</strong>
                <p>
                  Type <b>RESET DATA</b> exactly to unlock the reset button.
                </p>
              </div>

              <input
                value={resetConfirmation}
                onChange={(event) => setResetConfirmation(event.target.value)}
                placeholder="RESET DATA"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="settings-reset-footer">
              <p>
                Export a full backup before resetting if you need to keep the
                current student records.
              </p>

              <button
                type="button"
                className="settings-danger-button"
                disabled={
                  resetBusy || resetConfirmation !== 'RESET DATA'
                }
                onClick={resetStudentData}
              >
                {resetBusy ? 'Resetting…' : 'Reset student data'}
              </button>
            </div>

            <Notice message={resetResult} />
          </div>
        </section>
      ) : view === 'terms' ? (
        <section className="settings-modern-content">
          <div className="settings-section-intro">
            <div>
              <span className="eyebrow">ACADEMIC STRUCTURE</span>
              <h2>School years & semesters</h2>
              <p>
                Create and manage the academic periods used throughout the
                system.
              </p>
            </div>
          </div>

          <Records tab="Terms" />
        </section>
      ) : view === 'announcements' ? (
        <section className="settings-modern-content">
          <div className="settings-section-intro">
            <div>
              <span className="eyebrow">STUDENT COMMUNICATION</span>
              <h2>Announcements</h2>
              <p>
                Send an in-app update to every active student or target one
                subject.
              </p>
            </div>
          </div>

          <form
            className="settings-card settings-announcement-form"
            onSubmit={sendAnnouncement}
          >
            <div className="settings-card-heading">
              <div>
                <h3>New announcement</h3>
                <p>Compose the message students will see in their dashboard.</p>
              </div>
              <span className="settings-status-chip">In-app</span>
            </div>

            <div className="settings-form-grid">
              <label>
                Audience
                <select
                  value={announcementTarget}
                  onChange={(event) => {
                    const value = event.target.value as 'all' | 'subject';
                    setAnnouncementTarget(value);
                    if (value === 'all') setAnnouncementSubject('');
                  }}
                >
                  <option value="all">All active students</option>
                  <option value="subject">Specific subject</option>
                </select>
                <small className="settings-field-help">
                  Choose who should receive this announcement.
                </small>
              </label>

              {announcementTarget === 'subject' && (
                <label>
                  Subject
                  <select
                    required
                    value={announcementSubject}
                    onChange={(event) =>
                      setAnnouncementSubject(event.target.value)
                    }
                  >
                    <option value="">Choose a subject</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                        {subject.code ? ` — ${subject.code}` : ''}
                      </option>
                    ))}
                  </select>
                  <small className="settings-field-help">
                    Only active students enrolled in this subject will receive
                    it.
                  </small>
                </label>
              )}
            </div>

            <label>
              Announcement title
              <input
                required
                maxLength={160}
                value={announcementTitle}
                onChange={(event) => setAnnouncementTitle(event.target.value)}
                placeholder="e.g. Schedule update"
              />
              <small className="settings-field-help">
                {announcementTitle.length}/160 characters
              </small>
            </label>

            <label>
              Message
              <textarea
                required
                rows={6}
                maxLength={5000}
                value={announcementMessage}
                onChange={(event) => setAnnouncementMessage(event.target.value)}
                placeholder="Write the announcement students should see."
              />
              <small className="settings-field-help">
                {announcementMessage.length}/5000 characters
              </small>
            </label>

            <div className="settings-form-footer">
              <p>
                Students can dismiss announcements after they have read them.
              </p>
              <button disabled={busy}>
                {busy ? 'Sending…' : 'Send announcement'}
              </button>
            </div>

            <Notice message={message} />
          </form>
        </section>
      ) : (
        <section className="settings-modern-content">
          <div className="settings-section-intro">
            <div>
              <span className="eyebrow">GENERAL SETTINGS</span>
              <h2>Branding & student content</h2>
              <p>
                Update the system identity and the guidance students see when
                they enter their learning space.
              </p>
            </div>
          </div>

          <form
            className="settings-general-layout"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setMessage('');

              try {
                const { error } = await db()
                  .from('settings')
                  .update(draft)
                  .eq('id', 1);

                if (error) throw error;

                onBranding(draft);
                setMessage('Branding saved.');
              } catch (error) {
                setMessage(errorText(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="settings-card">
              <div className="settings-card-heading">
                <div>
                  <h3>System identity</h3>
                  <p>Name and short tagline displayed throughout the system.</p>
                </div>
              </div>

              <div className="settings-form-grid">
                <label>
                  System name
                  <input
                    required
                    value={draft.system_name}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        system_name: event.target.value,
                      })
                    }
                    placeholder="MasteryHub Review"
                  />
                </label>

                <label>
                  Tagline
                  <input
                    required
                    value={draft.tagline}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        tagline: event.target.value,
                      })
                    }
                    placeholder="Review • Practice • Progress"
                  />
                </label>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-card-heading">
                <div>
                  <h3>Student-facing content</h3>
                  <p>
                    Edit the welcome message and instructions shown to students.
                  </p>
                </div>
              </div>

              <label>
                Welcome message
                <textarea
                  required
                  rows={4}
                  value={draft.welcome}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      welcome: event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Student instructions
                <textarea
                  required
                  rows={4}
                  value={draft.instructions}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      instructions: event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="settings-card settings-logo-card">
              <div className="settings-card-heading">
                <div>
                  <h3>System logo</h3>
                  <p>
                    PNG, JPEG, or WebP. Maximum file size is 2 MB.
                  </p>
                </div>
              </div>

              <div className="settings-logo-layout">
                <div className="settings-logo-preview">
                  {draft.logo_path ? (
                    <ImageAttachment
                      bucket="branding"
                      path={draft.logo_path}
                    />
                  ) : (
                    <div className="settings-logo-empty">
                      <strong>No logo uploaded</strong>
                      <span>Your system name will still be displayed.</span>
                    </div>
                  )}
                </div>

                <div className="settings-logo-actions">
                  <label className="settings-file-field">
                    Upload logo
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busy}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;

                        setBusy(true);
                        setMessage('');

                        try {
                          setDraft({
                            ...draft,
                            logo_path: await uploadImage(file, 'branding'),
                          });
                        } catch (error) {
                          setMessage(errorText(error));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </label>

                  {draft.logo_path && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          logo_path: null,
                        })
                      }
                    >
                      Remove logo
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="settings-save-bar">
              <div>
                <strong>General settings</strong>
                <span>Save changes when you are ready.</span>
              </div>
              <button disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>

            <Notice message={message} />
          </form>
        </section>
      )}
    </div>
  );
}

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

type SettingsView = 'branding' | 'terms' | 'announcements';

type SubjectOption = {
  id: string;
  name: string;
  code: string;
};

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

  async function sendAnnouncement(event: React.FormEvent) {
    event.preventDefault();

    if (
      announcementTarget === 'subject' &&
      !announcementSubject
    ) {
      setMessage('Choose a subject first.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const recipientCount = await rpc<number>('send_announcement', {
        target_subject:
          announcementTarget === 'subject'
            ? announcementSubject
            : null,
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
    <div className="admin-standard-page">
      <div className="page-heading admin-page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>System settings</h1>
          <p>Branding, student-facing content, announcements, and school terms.</p>
        </div>

        <div className="actions admin-page-actions">
          {view !== 'branding' && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setView('branding');
                setMessage('');
              }}
            >
              Branding settings
            </button>
          )}

          {view !== 'announcements' && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setView('announcements');
                setMessage('');
              }}
            >
              Announcements
            </button>
          )}

          {view !== 'terms' && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setView('terms');
                setMessage('');
              }}
            >
              Manage school years / semesters
            </button>
          )}
        </div>
      </div>

      {view === 'terms' ? (
        <Records tab="Terms" />
      ) : view === 'announcements' ? (
        <form
          className="panel stack narrow admin-standard-editor admin-settings-form"
          onSubmit={sendAnnouncement}
        >
          <div>
            <span className="eyebrow">STUDENT ANNOUNCEMENT</span>
            <h2>Send announcement</h2>
            <p>
              Send an in-app announcement to all active students or only students
              enrolled in a selected subject.
            </p>
          </div>

          <label>
            Send to
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
            </label>
          )}

          <label>
            Title
            <input
              required
              maxLength={160}
              value={announcementTitle}
              onChange={(event) =>
                setAnnouncementTitle(event.target.value)
              }
              placeholder="e.g. Schedule update"
            />
          </label>

          <label>
            Message
            <textarea
              required
              rows={5}
              maxLength={5000}
              value={announcementMessage}
              onChange={(event) =>
                setAnnouncementMessage(event.target.value)
              }
              placeholder="Write the announcement students should see."
            />
          </label>

          <button disabled={busy}>
            {busy ? 'Sending…' : 'Send announcement'}
          </button>

          <Notice message={message} />
        </form>
      ) : (
        <form
          className="panel stack narrow admin-standard-editor admin-settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);

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
          {(
            [
              'system_name',
              'tagline',
              'welcome',
              'instructions',
            ] as const
          ).map((key) => (
            <label key={key}>
              {key.replaceAll('_', ' ')}
              {key === 'welcome' || key === 'instructions' ? (
                <textarea
                  required
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      [key]: event.target.value,
                    })
                  }
                />
              ) : (
                <input
                  required
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      [key]: event.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}

          <ImageAttachment
            bucket="branding"
            path={draft.logo_path}
          />

          <label>
            Logo (PNG, JPEG, WebP; up to 2 MB)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;

                setBusy(true);

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

          <button disabled={busy}>
            Save branding
          </button>

          <Notice message={message} />
        </form>
      )}
    </div>
  );
}

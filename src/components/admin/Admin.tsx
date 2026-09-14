'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import type { Branding } from '../Workspace';
import Account from '../Account';
import Records from './Records';
import Reviewers from './Reviewers';
import Results from './Results';
import SettingsPanel from './SettingsPanel';
import { Notice, errorText } from '../shared';

type AdminProps = {
  tab: string;
  profile: Profile;
  branding: Branding;
  onBranding: (branding: Branding) => void;
};

type StudentsSection = 'Students' | 'Subjects';
type QuizSection = 'Reviewers';
type SettingsSection = 'General' | 'Account';

const STUDENTS_SECTION_KEY = 'masteryhub:admin-students-section';
const QUIZ_SECTION_KEY = 'masteryhub:admin-quiz-section';
const SETTINGS_SECTION_KEY = 'masteryhub:admin-settings-section';

function storedSection<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof window === 'undefined') return fallback;

  const saved = window.sessionStorage.getItem(key) as T | null;
  return saved && allowed.includes(saved) ? saved : fallback;
}

function SectionNav({
  items,
  active,
  onChange,
  label,
}: {
  items: string[];
  active: string;
  onChange: (item: string) => void;
  label: string;
}) {
  return (
    <div className="admin-section-nav-wrap">
      <span className="eyebrow">{label}</span>

      <div className="admin-section-nav" role="tablist" aria-label={label}>
        {items.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={active === item}
            className={active === item ? 'active' : ''}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Admin({
  tab,
  profile,
  branding,
  onBranding,
}: AdminProps) {
  const [counts, setCounts] = useState([0, 0, 0, 0]);
  const [message, setMessage] = useState('');

  const [studentsSection, setStudentsSection] = useState<StudentsSection>(() =>
    storedSection(
      STUDENTS_SECTION_KEY,
      ['Students', 'Subjects'] as const,
      'Students',
    ),
  );
  const [quizSection, setQuizSection] = useState<QuizSection>(() =>
    storedSection(
      QUIZ_SECTION_KEY,
      ['Reviewers', 'Question Bank'] as const,
      'Reviewers',
    ),
  );
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() =>
    storedSection(
      SETTINGS_SECTION_KEY,
      ['General', 'Account'] as const,
      'General',
    ),
  );

  useEffect(() => {
    if (tab !== 'Dashboard') return;

    Promise.all(
      ['profiles', 'subjects', 'questions', 'attempts'].map(async (table) => {
        let query = db()
          .from(table)
          .select('id', { head: true, count: 'exact' });

        if (table === 'profiles') query = query.eq('role', 'student');
        if (table === 'attempts') query = query.eq('status', 'pending_review');

        const { count, error } = await query;
        if (error) throw error;

        return count || 0;
      }),
    )
      .then(setCounts)
      .catch((error) => setMessage(errorText(error)));
  }, [tab]);

  if (tab === 'Students') {
    return (
      <>
        <section className="admin-section-heading">
          <span className="eyebrow">STUDENT MANAGEMENT</span>
          <h1>Students & subjects.</h1>
          <p>
            Manage student accounts, organize subjects, and control which
            subjects each learner can access.
          </p>
        </section>

        <SectionNav
          label="MANAGE"
          items={['Students', 'Subjects']}
          active={studentsSection}
          onChange={(item) => {
            const next = item as StudentsSection;
            setStudentsSection(next);
            window.sessionStorage.setItem(STUDENTS_SECTION_KEY, next);
          }}
        />

        <Records key={studentsSection} tab={studentsSection} />
      </>
    );
  }

  if (tab === 'Quiz & Reviewers') {
    return (
      <>
        <section className="admin-section-heading">
          <span className="eyebrow">QUIZ & REVIEWER TOOLS</span>
          <h1>Build, organize & publish reviewers.</h1>
          <p>
            Manage your reviewers and question bank from one place. Bulk
            question tools remain inside the Question Bank.
          </p>
        </section>

        <SectionNav
          label="QUIZ WORKSPACE"
          items={['Reviewers']}
          active={quizSection}
          onChange={(item) => {
            const next = item as QuizSection;
            setQuizSection(next);
            window.sessionStorage.setItem(QUIZ_SECTION_KEY, next);
          }}
        />

        <Reviewers />
      </>
    );
  }

  if (tab === 'Results') {
    return (
      <>
        <section className="admin-section-heading">
          <span className="eyebrow">RESULTS & REVIEW</span>
          <h1>Attempts, scores & grading.</h1>
          <p>
            Review student attempts, scores, and responses that need manual
            grading.
          </p>
        </section>

        <Results />
      </>
    );
  }

  if (tab === 'Settings') {
    return (
      <>
        <section className="admin-section-heading">
          <span className="eyebrow">SYSTEM SETTINGS</span>
          <h1>Customize & manage your account.</h1>
          <p>
            Keep system branding and administrator account tools together in
            one place.
          </p>
        </section>

        <SectionNav
          label="SETTINGS"
          items={['General', 'Account']}
          active={settingsSection}
          onChange={(item) => {
            const next = item as SettingsSection;
            setSettingsSection(next);
            window.sessionStorage.setItem(SETTINGS_SECTION_KEY, next);
          }}
        />

        {settingsSection === 'General' ? (
          <SettingsPanel branding={branding} onBranding={onBranding} />
        ) : (
          <Account profile={profile} />
        )}
      </>
    );
  }

  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">A CLEARER VIEW OF LEARNING</span>
          <h1>
            Your learning
            <br />
            workspace, organized.
          </h1>
          <p>
            Manage your students, shape your reviewers, and keep every learner
            moving forward.
          </p>
          <span className="pill">Administrator workspace</span>
        </div>

        <div className="hero-art" aria-hidden="true">
          <div className="paper">
            Thoughtfully
            <br />
            <b>organized.</b>
            <hr />
            Ready for
            <br />
            <b>progress.</b>
            <span>✦</span>
          </div>
        </div>
      </section>

      <Notice message={message} />

      <div className="stats">
        {['Students', 'Subjects', 'Bank questions', 'Pending review'].map(
          (label, index) => (
            <article key={label}>
              <span className="eyebrow">{label}</span>
              <strong>{counts[index].toLocaleString()}</strong>
              <small>
                {index === 3
                  ? 'Responses need your attention'
                  : 'Across your workspace'}
              </small>
            </article>
          ),
        )}
      </div>

      <section className="panel">
        <span className="eyebrow">YOUR WORKFLOW</span>
        <h2>From question bank to confident learners.</h2>

        <div className="workflow">
          {[
            'Create or import students',
            'Create subjects & enroll',
            'Build your question bank',
            'Create & publish reviewers',
            'Review results & export',
          ].map((step, index) => (
            <div key={step}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <p>{step}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

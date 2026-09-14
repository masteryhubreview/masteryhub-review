# Release-blocking acceptance checklist

Run against a dedicated staging project before production. Mark each case only after testing; no item is pre-approved.

## Build and authentication

- [ ] npm install, npm run typecheck, npm test and npm run build succeed.
- [ ] Run supabase/tests/scoring.sql; all assertions pass.
- [ ] Sign in as admin; change display name, email and password; test reauthentication and email confirmations.
- [ ] Direct Supabase signup API requests are rejected with hosted signups disabled.
- [ ] Forgot-password flow sends to a real account and /reset changes the password; expired/invalid links fail safely.
- [ ] Anonymous and expired bearer tokens cannot provision accounts.
- [ ] A student calling /api/students receives 403.
- [ ] Browser assets and GitHub contain no service key, personal records or real credentials.

## Enrollment and student isolation

Create student A enrolled only in Mathematics; student B enrolled only in English.

- [ ] A cannot list English or start an English reviewer even by directly calling start_attempt.
- [ ] A cannot fetch B's attempt via get_attempt or read B's profile.
- [ ] Students cannot select questions, raw attempts, answer keys, audit records or another student's responses.
- [ ] Students cannot directly insert/update attempts, scores, enrollments or profile roles.
- [ ] Deactivate A while signed in; data operations are blocked with the existing session.
- [ ] Reactivate A; access resumes only for active enrollments and active subjects/terms.
- [ ] Published reviewers work with the administrator signed out.

## Question model and scoring

- [ ] Test all six question types, including multiple accepted variations, strict mode, empty optional answers, and a three-blank partial score.
- [ ] Multiple choice order shuffles without breaking correct IDs.
- [ ] Unknown/duplicate choice IDs and malformed answer shapes are rejected by save_response.
- [ ] Wrong-case/extra whitespace are normalized only when strict is false.
- [ ] Short answers without accepted variants and paragraph responses show pending review, never automatic wrong.
- [ ] Manual scores outside 0..question maximum are rejected; corrections update totals and append grade audit records.

## Attempt lifecycle

- [ ] Two simultaneous start calls return one active attempt and never exceed a limit.
- [ ] Refresh restores the same question selection and order.
- [ ] Non-feedback draft autosave succeeds; network interruption shows an error and does not claim Saved.
- [ ] Confirmed feedback responses cannot be edited; empty responses do not unlock keys.
- [ ] OFF feedback never returns correctness or answer keys in network payloads before submission.
- [ ] show_correct OFF hides answer keys even when review is otherwise allowed.
- [ ] allow_review OFF returns no completed questions to the student.
- [ ] Require-all rejects submissions with missing blanks; optional blanks score correctly.
- [ ] Double-click or repeated submission returns the same completed result.
- [ ] An edited source question/reviewer does not change the existing attempt snapshot, settings or score.
- [ ] Random count larger than the active eligible pool fails cleanly.

## Admin, import and history

- [ ] Create/edit/deactivate student; set a term; create/reactivate subject and term; create/disable enrollment.
- [ ] Import students/questions with quoted CSV, duplicates, invalid references and valid records; verify row-level reporting.
- [ ] Retry failed import rows without re-importing successful rows in the same preview.
- [ ] Attach, replace and remove a question image; old attempt image still renders.
- [ ] Student cannot read another student's question image path. Signed links expire as expected.
- [ ] Search 30,000 questions, switch pages and build a selected pool without fetching the full bank.
- [ ] Duplicate a reviewer to a draft; publish/unpublish; navigate fixed question order.
- [ ] Export term students, filtered results and full attempt JSON; compare exported counts with the database.
- [ ] Student deletion is blocked when attempts exist; deactivation preserves all history.
- [ ] A student without attempts can be removed after verified export; no active orphan account remains.

## Design and operations

- [ ] Test 360px phone, tablet portrait/landscape and desktop widths.
- [ ] Keyboard navigation, focus indication, long question text, 200% zoom and screen-reader form labels work.
- [ ] Lavender/pink theme preserves readable contrast; correctness is conveyed by text, not color alone.
- [ ] Password-reset delivery, backup restore, client account ownership and incident contacts are verified.
- [ ] Benchmark concurrent starts, autosaves and exports against the chosen Supabase/Vercel plan.
- [ ] Confirm each explicit scoring/lifecycle interpretation in ARCHITECTURE.md with the client.

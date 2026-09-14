# Architecture and policy decisions

## Order of implementation

Full requirements reviewed; schema and security designed; question and scoring models defined; CSV import format defined; then UI authored. No teacher role, AI integration, payment system, native app, public registration page or page builder exists.

## Data model

profiles references Supabase Auth users and stores the role, active status, student number and organizational term. terms contains school-year/semester labels. enrollments grants subject access in an active term; a profile's term_id is for batch organization, not itself an access grant. subjects stores editable academic categories. questions stores validated typed JSONB, indexed by subject and searchable question text. choices and accepted variants are nested value objects with stable choice IDs; they are not publicly readable tables.

reviewers stores settings and publication status. reviewer_questions is the ordered fixed list or random eligible pool. attempts stores immutable question/choice/answer-key snapshots, copied settings, saved responses, grades, totals and dates. grade_audit records administrator changes. settings stores branding. Supabase Storage stores private attachments.

## Authentication and authorization

Browser sessions use Supabase Auth. The browser public key grants no administrative privilege. Every data table has RLS. Roles are read from the profiles table, never from editable user metadata. A signup-created profile is always a student. Public signup MUST be disabled in hosted Supabase.

Management reads/writes are admin-only under RLS. Student account provisioning uses a Next.js route that validates the bearer token with Supabase Auth, checks the active admin profile, applies a database throttle and only then uses the server key. The server key is never imported into a client module.

Students may directly read their own profile and enrollments, authorized active subjects, published reviewers and branding. They cannot select the question bank, raw attempts, snapshots, answer keys, grades or audit table. They cannot directly insert/update attempts or scores. Controlled SECURITY DEFINER functions validate the caller on every operation, use an empty search_path and explicit schema names, and project only the permitted fields.

Each start locks the student profile before checking the attempt count. Saving, submitting and manual grading lock the attempt row. Submitting is idempotent. A unique partial index permits only one in-progress attempt per student/reviewer. New starts require publication and current enrollment. In-progress attempts can finish after unpublishing if enrollment remains active. Deactivation or removal of active enrollment revokes application data access even for an unexpired browser session.

## Question JSON

Common fields: type, text, points, strict, image_path, choices, correct, accepted. Optional attachment is a property, not a question type. choices is an array of {id,text}; correct lists stable choice IDs; accepted is a two-dimensional string array, one accepted-variant list per blank. The database trigger validates question writes in addition to the browser validator.

mc_single requires exactly one correct choice. mc_multi uses exact set equality (no partial multiple-choice credit). fill_blank and defined short_answer use trimmed, collapsed whitespace and case-insensitive matching unless strict is enabled. long_answer and short_answer without accepted variants need manual grading. multi_blank scores each blank independently; points are proportional to correct blanks, rounded to four decimals. No punctuation stripping, accent folding or fuzzy matching is applied. Empty optional responses receive zero rather than entering the manual queue.

## Explicit interpretations requiring client acceptance

The original specification did not decide every grading/lifecycle detail. These decisions are implemented and visible rather than hidden:

- Multi-blank questions use partial credit; multi-select questions use all-or-nothing exact-set scoring.
- Limits apply per student/reviewer across terms. Re-enrolling never resets attempt counts. This corrects the earlier planning response's inconsistent suggestion of a reset without an enrollment-linked counter. For a fresh term, duplicate the reviewer to create a fresh attempt scope while preserving history.
- No timer is added. Non-feedback drafts autosave after 700 ms and on navigation. Instant-feedback answers require confirmation and then lock. Unconfirmed instant-feedback drafts are not persisted; leaving warns the user. Unsaved local edits may be lost if the device or browser crashes before a successful save.
- Manual-review results show awarded points so far and pending count, not a misleading final percentage. Final totals appear after all pending answers are scored.
- Review/feedback settings are snapshotted at start, including answer visibility. Edits govern NEW attempts, not historical permissions. Changing a setting does not revoke previously disclosed answers.
- Inactive terms/enrollments revoke student access to associated history; admins retain access. Students need active subject access to reopen a result. Organizational term and enrollment term serve different purposes.
- Students with attempts cannot be permanently removed through the UI. Deactivate them. Students without attempts can be removed after a backup confirmation. No historical attempts are automatically deleted.
- Short accepted variants are entered with | separators in the editor; CSV JSON can represent arbitrary strings including vertical bars.

Review these policy decisions with the client before live use; change the implementation and acceptance tests if another interpretation is required.

## Performance and integrity

Admin tables query 25 records per page; reviewer cards use 12. Question pickers fetch 25 and never load the full bank. Remote selectors search server-side. Selected reviewer pools and explicit exports fetch successive pages; these are intentionally full-pool/full-export operations. Student subject selection currently requests up to the first 1,000 authorized subjects; this is a display query bound, not a database/student/question limit.

Random selection uses PostgreSQL random() on an eligible reviewer pool, not a client-side choice. Snapshot order and stable answer IDs survive refreshes. For very large pools or high concurrency, benchmark random ordering and JSON snapshot write costs before scaling. Database indexes support enrollment checks, question search and history filtering. Replaced images are retained; signed URLs expire after one hour and should not be treated as instantly revocable after a role or enrollment change.

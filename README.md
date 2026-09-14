# ReviewHub

Custom web-based quiz and reviewer system using Next.js, TypeScript, Supabase Auth/PostgreSQL/Storage, GitHub, and Vercel. Lavender, pink, white, and black responsive theme. There are exactly two roles: admin and student.

## Delivery status

This archive contains source code, database migration, configuration examples, import templates, tests, and deployment instructions. It is NOT a deployed or independently production-certified system. Dependency installation, TypeScript compilation, SQL execution against Supabase, browser testing and end-to-end security tests must be completed in your environment before onboarding real students. No credentials, node_modules, lockfile, live database or hosted services are included.

All files are NEW. The earlier chat schema was a proposal, not an applied migration. This implementation uses JSONB for the six-type question model and immutable attempt snapshots; the authoritative schema is supabase/migrations/001_reviewhub.sql. Do not apply it on top of the earlier proposed SQL without a reviewed migration.

## 1. Open in VS Code

1. Extract reviewhub-project.zip.
2. Open the extracted reviewhub folder with VS Code using File > Open Folder.
3. Install Node.js 22.18+ (or a supported newer LTS).
4. Open VS Code Terminal > New Terminal in that folder.
5. Run npm install.
6. Copy .env.example to .env.local and fill in your client-owned Supabase project values.

Windows PowerShell: Copy-Item .env.example .env.local
macOS/Linux: cp .env.example .env.local

The NEXT_PUBLIC_SUPABASE_ANON_KEY variable accepts your Supabase public/anon key. It is intentionally visible to the browser and relies on RLS. SUPABASE_SERVICE_ROLE_KEY must remain server-only. Never prefix it NEXT_PUBLIC, paste it into UI fields, or commit .env.local.

## 2. Configure Supabase

Create a NEW, dedicated client-owned Supabase project. In SQL Editor run supabase/migrations/001_reviewhub.sql once. It creates tables, constraints, policies, scoring functions and private image buckets. This is not an idempotent reset script.

In Authentication settings:
- Turn OFF Allow new users to sign up. This is mandatory; hiding a registration button is not sufficient.
- Disable anonymous sign-ins and unused providers.
- Set minimum password length to at least 12.
- Keep secure email-change confirmation enabled.
- Set Site URL to your application URL.
- Add exact redirect URLs http://localhost:3000/reset and https://YOUR_DOMAIN/reset.
- Verify password-reset email delivery with a real test account. Default email delivery restrictions may not support every production recipient. Resolve email delivery with the client before go-live; do not silently add a paid provider.

Buckets are private: question-images accepts PNG/JPEG/WebP up to 5 MB; branding accepts up to 2 MB. Files are uploaded to immutable random paths. Replaced/removed question attachments are retained so old attempt images are not destroyed.

## 3. Create the first administrator

Use a dedicated admin email, different from student accounts. Set temporary environment variables in your terminal, then run the bootstrap script. It reads Supabase values from .env.local.

PowerShell:

    $env:ADMIN_EMAIL="YOUR_ADMIN_EMAIL"
    $env:ADMIN_PASSWORD="YOUR_UNIQUE_LONG_PASSWORD"
    npm run bootstrap-admin
    Remove-Item Env:ADMIN_PASSWORD

macOS/Linux:

    ADMIN_EMAIL="YOUR_ADMIN_EMAIL" ADMIN_PASSWORD="YOUR_UNIQUE_LONG_PASSWORD" npm run bootstrap-admin

Do not commit passwords or share your terminal history. The script creates an account with the Administrator display name and elevates its profile using the server-only key. Student creation never accepts a role parameter. If bootstrap fails after account creation, inspect that account before retrying; do not blindly create another admin.

## 4. Run locally

    npm run dev

Open http://localhost:3000 and sign in. There is no fake login or embedded sample password. Without Supabase configuration, the app shows a configuration message rather than substituting local mock data.

Admin setup order:
1. Settings > Manage school years / semesters: create a term.
2. Subjects: create Mathematics, English, Science and General Knowledge if needed. All names are editable.
3. Students: create or import accounts; assign their organizational term.
4. Enrollment: grant each student access to subjects in an active term.
5. Question Bank: create/import questions, attach images, and review content.
6. Reviewers: select a subject, fixed set or random pool, choose questions, set options, publish.
7. Results: review subjective responses and save grades.
8. Export records and full attempt archives before any cleanup.

## 5. Verify before production

    npm run typecheck
    npm test
    npm run build
    npm start
    npm audit

Resolve all failures and review dependency advisories before deployment. npm install generates package-lock.json; review and commit it, then use npm ci in CI and deployments. CI is supplied without a lockfile and initially uses npm install.

Run the SQL scoring checks in supabase/tests/scoring.sql in the test project. Complete docs/ACCEPTANCE.md using two student accounts with different enrollments plus an administrator. Tests supplied here are not evidence they have passed on your project.

## 6. GitHub and Vercel

Create the repository and Vercel project in client-owned accounts. Push the extracted project, excluding .env.local and node_modules. Import the repository in Vercel as a Next.js application. Select Node.js 22 or newer, and add the three .env.example variables in the intended environment. Preview and production must not inadvertently share live student data.

Set the production site and reset redirect URLs in Supabase. Deploy, complete the acceptance checklist again on the production domain with test users, verify backup/restore, and only then enroll real students. Review service quotas and costs with the client; this source code does not guarantee zero hosting, email, storage, or database costs.

## Documentation

- docs/ARCHITECTURE.md: authorization, schema, scoring and explicit policy decisions.
- docs/IMPORTS.md: CSV field formats and examples.
- docs/ACCEPTANCE.md: release-blocking security and user-flow checklist.
- docs/OPERATIONS.md: backups, lifecycle, client ownership and limitations.
- docs/ORIGINAL-SPECIFICATION.txt: original requirements supplied with this project.

## Theme

Edit src/app/globals.css for design tokens. System name, logo, tagline, welcome message and instructions are editable in Admin > Settings without changing source. Colors: lavender #D8CCFA, pink #F9D9E6, white #FFFFFF, near-black #18151D, accessible dark-purple actions #563685. Feedback uses separate green/rose accents and text labels.

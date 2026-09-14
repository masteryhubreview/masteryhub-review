# Operating ReviewHub

## Client ownership

Use dedicated client-controlled email, GitHub, Vercel and Supabase accounts. The client should own billing, recovery methods and production administrator credentials. Give maintainers limited collaborator access rather than sharing owner passwords. Enable MFA on the infrastructure accounts and protect the main branch.

## Archives and deletion

Export students by term and results using the appropriate filters. Use Full archive JSON to retain attempt snapshots and answers. Open and verify the exported files before any removal. No export triggers deletion. The application intentionally refuses deleting students with historical attempts; deactivate them instead. Terms, subjects and enrollment history should generally be deactivated rather than deleted.

A database backup and a Storage backup are still required for full disaster recovery. Application exports are not a one-click restore package. Establish the backup schedule, retention rules and restore procedure in the client project, and test restores in staging. Agree any legal retention/deletion requirements before production; a verified permanent-erasure workflow for historical attempts is not supplied.

## Account changes

A student's active flag is authoritative for data access and is checked at the database on each operation. Term bulk deactivation changes those flags; it does not delete Auth users. An already issued image URL can remain readable for up to one hour. Account management involves Supabase Auth and PostgreSQL, which are not one shared transaction; failures are reported and may require an admin to correct/retry an account change. Never assume a partial failure succeeded.

## Limits and performance

There is no 300-student or 30,000-question business cap. Regular tables are paginated. Browser imports and explicit exports run while the tab stays open. Large imports may require retrying throttled rows; large JSON exports consume browser memory. For unusually large histories, use verified database exports under the project owner rather than assuming unlimited browser capacity. Do not add a background worker/service without client approval.

Monitor database usage, Storage, Auth email delivery, Vercel function logs and error rates in the client-owned services. Do not log passwords or full student answers. Review npm advisories regularly, commit a package lock after installation and test upgrades in staging.

## Security hardening before release

Verify public signup is OFF in the hosted Supabase settings. Keep the service key only in server secrets. Restrict production reset redirect URLs to exact trusted locations. The supplied Content Security Policy allows inline scripts/styles and eval for compatibility; assess a nonce-based production policy during security review. Authentication tokens use the Supabase browser SDK's session storage behavior; protect against XSS and avoid rendering arbitrary HTML. Question text is rendered as text, not executable markup. Uploaded SVG is not allowed. No payment, AI or unrelated external service is integrated.

## Known validation boundary

This delivery was assembled as source, not installed or deployed against your client accounts. Live SQL migrations, TypeScript build, browser behavior, Auth email delivery, concurrent transaction tests and security penetration testing must be verified on staging. Do not represent the ZIP itself as proof of production readiness. The supplied test files and checklist are a starting release gate, not a substitute for execution and review.

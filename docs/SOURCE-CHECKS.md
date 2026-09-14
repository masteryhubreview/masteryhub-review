# Source checks performed during packaging

- JSON parses: package.json
- JSON parses: tsconfig.json
- JSON parses: .vscode/extensions.json
- JSON parses: .vscode/settings.json
- Question editor uses real newline escapes
- CSV round-trip preserves quotes, commas and newlines
- CSV BOM and CRLF handled
- Malformed CSV row rejected
- CSV export neutralizes formulas
- Template parses: public/templates/questions.csv
- Question template covers every type and both short-answer modes
- Template parses: public/templates/students.csv
- Question validator accepts mc_single / What is 2 + 2?
- Question validator accepts mc_multi / Select the even numbers.
- Question validator accepts fill_blank / The capital of the Philippines is _____.
- Question validator accepts short_answer / Name the gas represented by O2.
- Question validator accepts short_answer / Explain your approach briefly.
- Question validator accepts long_answer / Describe how you would solve this problem and why.
- Question validator accepts multi_blank / Give red, green and blue in that order.
- Question validator rejects foreign answer keys
- Short passwords rejected
- Zero attempt limit rejected
- All local import targets exist
- Theme has no third-party font dependency
- RPC declaration present: start_attempt
- RPC declaration present: save_response
- RPC declaration present: submit_attempt
- RPC declaration present: get_attempt
- RPC declaration present: my_attempts
- RPC declaration present: grade_response
- RPC declaration present: save_reviewer
- RPC declaration present: duplicate_reviewer
- RPC declaration present: admin_rate_limit
- RPC declaration present: set_display_name

These were archive/static checks and execution of the CSV/validation utilities after removing known TypeScript annotations. They are NOT a TypeScript compiler, Next.js build, database migration, browser or end-to-end security test. Complete ACCEPTANCE.md before production use.

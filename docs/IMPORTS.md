# Bulk import guide

Import format: UTF-8 CSV with headers and standard CSV quoting. The downloadable templates are also under public/templates. The UI previews the first 100 rows; the downloaded validation report covers every row. All rows must pass local validation before import. Server-side constraints are authoritative; an invalid foreign key or duplicate student number is reported when the row reaches the server.

## Students

display_name,email,password,student_number,term_id

Display name, valid email and temporary password of at least 12 characters are required. student_number and term_id may be empty. term_id is the school term UUID from a Terms export. Each student should receive a unique temporary password through a secure channel. Do not email or publicly upload a bulk password CSV; securely delete it when provisioning is complete.

The importer checks malformed rows and duplicate emails within a file. Accounts are created sequentially with per-row results. The server allows 120 admin account changes per minute; a large batch can encounter throttling. Wait a minute and choose Confirm import again to retry failed rows, while already imported rows in that preview are skipped. Do not re-import successful rows after editing/reloading the whole file; remove successful rows first. Import is not all-or-nothing; already successful rows remain saved if another fails.

## Questions

subject_id,data

subject_id is the subject UUID from a Subjects export. data is a JSON object serialized into a properly quoted CSV cell. Use a spreadsheet with the supplied template or generate CSV using a standard CSV writer. Every question is inserted into the bank; it is not automatically attached to or published in a reviewer. Review and edit imported content first, then select it in a reviewer.

Question JSON examples (shared default fields: points=1, strict=false, image_path=null):

- Single choice: type=mc_single; choices=[{"id":"a","text":"4"},{"id":"b","text":"5"}]; correct=["a"]; accepted=[].
- Multiple choices: type=mc_multi; correct contains the complete choice ID set.
- Fill blank: type=fill_blank; choices=[]; correct=[]; accepted=[["Manila","Manila City"]].
- Auto short answer: type=short_answer; accepted=[["oxygen","O2"]].
- Manual short answer: type=short_answer; accepted=[].
- Paragraph: type=long_answer; accepted=[].
- Three blanks: type=multi_blank; accepted=[["red"],["green"],["blue"]].

A human-readable text field is required in every object. Bulk image import is deliberately not implemented: image_path must be null/empty, then attach images through the normal editor. Database validation independently checks type-specific answer definitions.

Question import is per-row and can partially succeed. Keep the exported report. Successful rows are marked Imported and skipped on retry while the same preview remains open. Editing the CSV creates a new preview; remove previously successful rows before importing it again. There is no automatic question deduplication because two distinct questions may legitimately share text.

## Export safety

Student/result CSV exports neutralize leading spreadsheet formula characters. JSON full attempt archives preserve snapshots, responses and grades without CSV conversion. Treat exports as confidential educational records and answer keys. Exports do not include passwords; input provisioning CSVs do. A full disaster-recovery backup additionally needs the database and Storage objects, not just application exports.

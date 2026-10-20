# ADR-0166 — Mobile: Publish reports, PDF and slide download and share

**Status:** Proposed 2026-10-19
**Related:** parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4

## Decisions

1. **Saved reports list.** `GET /reports` lists the brand's saved report templates (name, range, compared with the period before, send schedule, last sent). Creating, editing, scheduling and deleting a template stay on veyrnox.ai for now.
2. **Download and share.** Each report has PDF and Slides buttons (shown only when the server says `reportExportsEnabled`). The app asks `GET /reports/:id/export?format=pdf|pptx`, reads the bytes (refusing an empty file or one over 25 MB), writes them to the app cache under a name built from the report id (never from server text), and opens the system share sheet with the right file type. Failures have their own messages (no numbers yet, not open, plan needed, offline).
3. No server change, no dependency (expo-file-system and expo-sharing are already used by the Library), no flag. Proved against nothing but unit tests of parsing, naming and error mapping: the file write and share sheet were not run on a device (owner disk rule), so the first real run needs a build.

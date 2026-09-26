# Workspace and projects preview

The `/app/projects` screen uses the existing tenant APIs to list workspaces and create, search, rename and soft-delete project metadata. It reuses the studio navigation, buttons, native modal, authenticated gateway and account boundary. It does not yet attach media or implement the canonical document/editor part of M01.

## Release boundary

The screen and navigation entry require `localStorage.veyrnox_projects = '1'`, following the new-path delivery gate in CLAUDE.md. This browser flag is not authorization: API JWT verification, RLS, role checks and `TENANT_PROJECTS_ENABLED` remain authoritative. Staging APIs are enabled by PR #334; production stays disabled. No migration is needed for this interface.

Creation retains its idempotency key for retries of the same payload while the dialog is open. Rename/delete submit the displayed version. A 409 preserves the draft and requires an explicit reload of the current project before the user can submit again. Lists discard late responses after workspace changes or unmount; the existing account boundary remounts private UI on account changes.

## Verification

- 663 unit/API tests: 662 pass, one existing skip.
- Client boundary check passed (73 modules); Next/OpenNext staging build passed, with seven existing lint warnings.
- 21st review of the project page and navigation: zero findings. Existing primitives were reused; no new dependencies installed in the project.
- Live staging browser: empty workspace, project creation, search/no matches, rename conflict induced by a second write, explicit reload preserving the draft, successful rename, and Escape cancellation with focus restored.
- Responsive inspection at 360 px found no document horizontal overflow. Follow-up layout stacks row controls and scrolls the active tab into view.

Final staging Worker version: `f0c43240-8b21-4b84-bef4-5698547613f2`. Verified the improved 360 px layout and 1280 px desktop view, then confirmed deletion through the UI and return to the empty state. Disabling the browser flag hid the navigation entry and project controls; re-enabling restored the screen. The test project was soft-deleted, viewport overrides reset, and the Projects screen left open with preview enabled for the user. No production or unrelated database changes were made.

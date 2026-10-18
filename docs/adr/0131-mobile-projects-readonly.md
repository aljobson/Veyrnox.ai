# ADR-0131 — Mobile: workspaces and projects (read-only)

**Status:** Proposed 2026-10-18
**Related:** [ADR-0051](0051-tenant-projects.md) (tenant projects), [ADR-0106](0106-mobile-app.md) (the app)

## Context

Projects are the editor's cloud saves: a workspace holds projects, and a project keeps numbered saved versions. The web has routes for them under `/api/v1/workspaces` and `/api/v1/projects`. The app showed none of it.

## Decisions

1. **A read-only Projects screen** (`/projects`, a link on Home): the person's workspaces (the default one selected, a picker when there are several) and the projects in the chosen workspace, newest first, with the version number and last update.
2. **A project screen** (`/projects/[id]`): its name, version, dates and the saved versions (version number, date, and "restored from version N" when it was a restore), 50 at a time, paged by the server's cursor. A page that adds nothing new stops paging.
3. **The editor document is not shown.** It is editor-specific JSON with nothing to render in the app. The screens say projects are made and edited in the editor on veyrnox.ai.
4. **Project files are not listed.** The server has no route that lists a project's assets, only reserve and download by id.
5. **Off is a 404.** All of these routes answer 404 while `TENANT_PROJECTS_ENABLED` is off, so the screen says projects are not available yet. They also return errors as `{error:{code,message}}` (an object), unlike the other `/api/v1` routes, so the app words errors by HTTP status.
6. **Nothing is changed**: no create, rename, restore or delete from the app.
7. No server change, no dependency, no flag.

## Not proved

- Anything against staging or production. The database reads use the person's own Bearer token (`tenantRequest` forwards it to PostgREST): **read from code, not run against a server**. The 404 path, the object-shaped error and a real workspace were shown only through unit tests and the dev mock.
- The flag state: `TENANT_PROJECTS_ENABLED` was not checked on staging.

## Manual checks for the owner

1. `TENANT_PROJECTS_ENABLED` on staging, one workspace with at least one project that has more than 50 saved versions.
2. The 404 answer with the flag off shows "Projects are not available yet".

## Consequences

- Server follow-ups: a string error code on these routes, and an assets list route if project files should ever show on mobile.

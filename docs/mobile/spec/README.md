# Mobile spec set

**Status:** Source refresh 2026-10-20 against checkout HEAD `df14bedb`; live deployment and device behaviour not verified.

**Evidence boundary:** This checkout HEAD is the single source baseline for all seven documents and the diagram. It includes the main changes reviewed with `git log b5bdc108..HEAD`: #1439 Face Filters activation, #1440 account-language test fixture, #1441 Publish confirmation, #1442 retained-asset deploy lookback, #1443 report-email language, #1445 sign-in/Account/composer hints and #1447 Explore ordering, plus the earlier spec commits and merges. Source was rechecked in `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/eas.json`, `apps/mobile/src/app/`, relevant `apps/mobile/src/` libraries, `docs/adr/`, migration 0357, `wrangler.jsonc` and `lib/cinema/features.js`. The fixture/deploy changes add no phone feature.

**PR evidence (2026-10-20 UTC):** `gh pr list --state merged --limit 200` and `gh pr list --state open --limit 200` succeeded during this refresh. The returned merged history corroborates the main changes above; the open list includes #1452 Continue watching, #1453 Face filters, #1454 Publish workflows and Plan status, #1455 Help guides, #1446 Face Filters docs, #1448 design tokens/sign-in and #1449 Explore resume placement. They are **in review**, not shipped at this baseline; see [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). A later retry at 19:16 UTC failed to connect, so subsequent remote changes are **not verified**. PR titles are status evidence, not proof of unmerged implementation.

| Role | Document | Answers | New status line |
|------|----------|---------|-----------------|
| Index | [README.md](README.md) | Evidence, links and precedence | **Status:** Source refresh 2026-10-20; same checkout HEAD baseline as this index; live deployment and device behaviour not verified. |
| PRD | [PRD.md](PRD.md) | Product scope and built/partial/blocked features | **Status:** Source refresh 2026-10-20; same checkout HEAD baseline as this index; live deployment and device behaviour not verified. |
| TRD | [TRD.md](TRD.md) | Stack, gateway, configuration sources and constraints | **Status:** Source refresh 2026-10-20; same checkout HEAD baseline as this index; live deployment and device behaviour not verified. |
| App flow | [APP-FLOW.md](APP-FLOW.md) | Current routes, navigation, first run and failures | **Status:** Source refresh 2026-10-20; same checkout HEAD baseline as this index; live deployment and device behaviour not verified. |
| UI/UX | [UI-UX.md](UI-UX.md) | Tokens, components, implementation and design gaps | **Status:** Source refresh 2026-10-20; same checkout HEAD baseline as this index; live deployment and device behaviour not verified. |
| Schema | [SCHEMA.md](SCHEMA.md) | Auth, local state, server ownership and pending migration | **Status:** Source refresh 2026-10-20; same checkout HEAD baseline as this index; live deployment and device behaviour not verified. |
| Build plan | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | Built work, in-review PRs, blockers and exit gates | **Status:** Source refresh 2026-10-20; same checkout HEAD baseline as this index; live deployment and device behaviour not verified. |

Related, not part of the set: [../PARITY-2026-10-19.md](../PARITY-2026-10-19.md) (every web feature against the phone, with sizes, spikes and owner decisions; the scope is all web features, per the owner on 2026-10-19), [../PLAN-2026-10-18.md](../PLAN-2026-10-18.md) (status and ownership), [../USER-JOURNEY-2026-10-19.md](../USER-JOURNEY-2026-10-19.md) (the journeys and slices N1 to N8), [../DEVICE-PASS-2026-10-18.md](../DEVICE-PASS-2026-10-18.md) (16 checks), [../M7-STORE-SUBMISSION-CHECKLIST.md](../M7-STORE-SUBMISSION-CHECKLIST.md) (store forms), mobile ADRs under `docs/adr/`, including ADR-0145 (grouped flags), ADR-0204 (passkeys), ADR-0207/0208 (Cinema), ADR-0210 (Film Studio), ADR-0230 (Oddlings) and ADR-0232 (Continue watching).

[Phone system architecture (HTML)](../diagrams/system-architecture.html) · [Archify source (JSON)](../diagrams/system-architecture.json). Type: `architecture`, 11 primary nodes. It covers phone, Worker Bearer ES256 gateway, Supabase Auth/Postgres, R2, Stream, RevenueCat/stores, Expo push, Sentry, provider webhooks and site OAuth hand-back. Webhooks terminate outside the Bearer-gated `/api/v1`; direct Auth and signed-media flows are explicit.


## Precedence

When two documents disagree: `CLAUDE.md`, then the ADRs, then `CONTEXT.md`, then the migrations (for anything about data), then this set, then the older mobile notes (`ROADMAP-2026-10-17.md`, `GAP-ANALYSIS-2026-10-17.md`).

## Who maintains it

The planning session writes and updates this set. The mobile session builds from it and owns `apps/mobile/**` and the mobile ADRs. If a spec contradicts the code, the mobile session says so in its PR and the planning session fixes the spec.


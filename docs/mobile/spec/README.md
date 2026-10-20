# Mobile spec set

**Status:** Source refresh 2026-10-20 against local `origin/main` at `b5bdc1081bbc5876f0852dd7be9628d4ba5da154`; live deployment and device behaviour not verified.

**Evidence boundary:** Source and local merge history were read at that pinned revision. `gh pr list --state merged --limit 200` and the open-PR query could not connect to GitHub; remote freshness and what is currently in review are **not verified**. Paths beginning `src/` are relative to `apps/mobile/`; other repository paths are relative to the checkout. Configuration states are source values, not a live environment inspection; see [TRD section 3](TRD.md#3-configuration-and-flags).

| Role | Document | Answers | New status line |
|------|----------|---------|-----------------|
| Index | [README.md](README.md) | Evidence, links and precedence | **Status:** Source refresh 2026-10-20 against local `origin/main` at `b5bdc1081bbc5876f0852dd7be9628d4ba5da154`; live deployment and device behaviour not verified. |
| PRD | [PRD.md](PRD.md) | Product scope and built/partial/blocked features | **Status:** Source refresh 2026-10-20 against local `origin/main` at `b5bdc1081bbc5876f0852dd7be9628d4ba5da154`; live deployment and device behaviour not verified. |
| TRD | [TRD.md](TRD.md) | Stack, gateway, configuration sources and constraints | **Status:** Source refresh 2026-10-20 against local `origin/main` at `b5bdc1081bbc5876f0852dd7be9628d4ba5da154`; live deployment and device behaviour not verified. |
| App flow | [APP-FLOW.md](APP-FLOW.md) | Current routes, navigation, first run and failures | **Status:** Source refresh 2026-10-20 against local `origin/main` at `b5bdc1081bbc5876f0852dd7be9628d4ba5da154`; live deployment and device behaviour not verified. |
| UI/UX | [UI-UX.md](UI-UX.md) | Tokens, components, implementation and design gaps | **Status:** Source refresh 2026-10-20 against local `origin/main` at `b5bdc1081bbc5876f0852dd7be9628d4ba5da154`; live deployment and device behaviour not verified. |
| Schema | [SCHEMA.md](SCHEMA.md) | Auth, local state, server ownership and pending migration | **Status:** Source refresh 2026-10-20 against local `origin/main` at `b5bdc1081bbc5876f0852dd7be9628d4ba5da154`; live deployment and device behaviour not verified. |
| Build plan | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | Built work, unverified review status, blockers and exit gates | **Status:** Source refresh 2026-10-20 against local `origin/main` at `b5bdc1081bbc5876f0852dd7be9628d4ba5da154`; live deployment and device behaviour not verified. |

Related, not part of the set: [../PARITY-2026-10-19.md](../PARITY-2026-10-19.md) (every web feature against the phone, with sizes, spikes and owner decisions; the scope is all web features, per the owner on 2026-10-19), [../PLAN-2026-10-18.md](../PLAN-2026-10-18.md) (status and ownership), [../USER-JOURNEY-2026-10-19.md](../USER-JOURNEY-2026-10-19.md) (the journeys and slices N1 to N8), [../DEVICE-PASS-2026-10-18.md](../DEVICE-PASS-2026-10-18.md) (16 checks), [../M7-STORE-SUBMISSION-CHECKLIST.md](../M7-STORE-SUBMISSION-CHECKLIST.md) (store forms), mobile ADRs under `docs/adr/`, including ADR-0145 (grouped flags), ADR-0204 (passkeys), ADR-0207/0208 (Cinema), ADR-0210 (Film Studio), ADR-0230 (Oddlings) and ADR-0232 (Continue watching).


[Phone system architecture (HTML)](../diagrams/system-architecture.html) · [Archify source (JSON)](../diagrams/system-architecture.json). Type: `architecture`, 11 primary nodes. It covers phone, Worker Bearer ES256 gateway, Supabase Auth/Postgres, R2, Stream, RevenueCat/stores, Expo push, Sentry, provider webhooks and site OAuth hand-back. Webhooks terminate outside the Bearer-gated `/api/v1`; direct Auth and signed-media flows are explicit.

**Refresh boundaries:** Remote GitHub queries failed; local `origin/main` is the pinned evidence snapshot, not a confirmed latest remote tip. This checkout starts at `88ef8eb95b126dd3c81131e0abc5fa20c8b246c2`; the baseline already differs from local main in 33 non-doc paths. The source was not rebased or changed. In particular, Schedule as composer default and the latest Character/camera hints were read from pinned main, not asserted to be in this older checkout. No device, live database, EAS account or deployment was inspected.

**Diagram verification:** Archify `validate` and `deliver` passed all 9 artifact checks at showcase quality, with 0 errors and 0 warnings. Browser evidence failed: Chrome aborted with SIGABRT before viewport inspection; perceptual visual review was not completed. This limitation does not turn deterministic artifact validation into a browser pass.

## Precedence

When two documents disagree: `CLAUDE.md`, then the ADRs, then `CONTEXT.md`, then the migrations (for anything about data), then this set, then the older mobile notes (`ROADMAP-2026-10-17.md`, `GAP-ANALYSIS-2026-10-17.md`).

## Who maintains it

The planning session writes and updates this set. The mobile session builds from it and owns `apps/mobile/**` and the mobile ADRs. If a spec contradicts the code, the mobile session says so in its PR and the planning session fixes the spec.

**Refresh proof (2026-10-20):** `cd apps/mobile && npx tsc --noEmit && npx jest --ci` exited 0 on rerun: 110 suites and 2,144 tests passed. The first Jest run had one temporary-fixture cleanup failure (`ENOTEMPTY` in `mergeFriendliness.test.ts`). The docs freshness test initially could not resolve root TypeScript; the required `npm run sync:vey-knowledge` was attempted and hit the same missing dependency. A temporary resolver outside the repository reused the already installed matching TypeScript 6.0.3 without installing or linking dependencies: all seven knowledge checks passed, and the sync reported already current (85 routes, 60 document sections), with no generated-file change.

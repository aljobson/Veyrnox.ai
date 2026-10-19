# Mobile spec set

**Status:** Proposed 2026-10-19. The six-document framework from `docs/face-filters/FRAMEWORK.md`, applied to the mobile app. Facts are from `main` at `4768d535`; nothing was run on a device.

| Role | Document | Answers |
|------|----------|---------|
| PRD | [PRD.md](PRD.md) | What is built, in flight, decided and deliberately not built; who it is for; success criteria; open questions |
| TRD | [TRD.md](TRD.md) | Stack, decisions with rejected alternatives, flags, security, budgets, tests, binding constraints |
| App flow | [APP-FLOW.md](APP-FLOW.md) | Routes, navigation (today and target), first run, create to publish, and a failure table with the credit consequence |
| UI/UX | [UI-UX.md](UI-UX.md) | Tokens, components, new components, screen shapes, copy, motion, accessibility floor |
| Schema | [SCHEMA.md](SCHEMA.md) | Sign-in flow, what the phone stores, server tables the features touch, who may write them |
| Build plan | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | What is done, then tracks A to E with exit gates |

Related, not part of the set: [../PLAN-2026-10-18.md](../PLAN-2026-10-18.md) (status and ownership), [../USER-JOURNEY-2026-10-19.md](../USER-JOURNEY-2026-10-19.md) (the journeys and slices N1 to N8), [../DEVICE-PASS-2026-10-18.md](../DEVICE-PASS-2026-10-18.md) (16 checks), [../M7-STORE-SUBMISSION-CHECKLIST.md](../M7-STORE-SUBMISSION-CHECKLIST.md) (store forms), ADR-0106 to 0143.

## Precedence

When two documents disagree: `CLAUDE.md`, then the ADRs, then `CONTEXT.md`, then the migrations (for anything about data), then this set, then the older mobile notes (`ROADMAP-2026-10-17.md`, `GAP-ANALYSIS-2026-10-17.md`).

## Who maintains it

The planning session writes and updates this set. The mobile session builds from it and owns `apps/mobile/**` and the mobile ADRs. If a spec contradicts the code, the mobile session says so in its PR and the planning session fixes the spec.

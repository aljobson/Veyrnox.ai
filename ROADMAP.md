# Roadmap

What gets built next, and what does not. Agents and contributors should work from this list instead of picking up whatever looks interesting. If something isn't here, it needs an issue or an ADR first.

> **Draft, 2026-10-01.** Compiled from open issues, open PRs, ADR statuses and recent commits, not from a prioritisation session. Order within each section is a suggestion until the product owner confirms it.

How to read it: **Now** is in flight or blocking launch. **Next** is decided (usually an accepted ADR) but not started or not finished. **Later** is real but waiting on something. **Not doing** is a deliberate no.

## Now: launch blockers

| Item | State | Where |
|---|---|---|
| Public sign-up and Credit Pack launch checklist | Open, owner-run | [#204](https://github.com/aljobson/Veyrnox.ai/issues/204), [#101](https://github.com/aljobson/Veyrnox.ai/issues/101), `docs/operations/credit-pack-launch-acceptance.md` |
| Sign-up gate stays closed (Confirm email, migration 0071, Turnstile) | Verified; recheck before widening sign-up | `npm run check:signup-gate`, ADR-0026 |
| Veyrnox Publish: finish YouTube and TikTok publish and get platform app review | YouTube resumable upload fixed in [#399](https://github.com/aljobson/Veyrnox.ai/pull/399) (merged 2026-10-03). Platform app review still to do. TikTok domain verification DNS record not yet published | ADR-0061, `docs/social-publisher/06-oauth-review-runbook.md` |

## Next: decided, not finished

- **Subscriptions** (Starter $19 / Plus $59 / Ultra $129). Accepted in ADR-0064, not built. Needs the ledger spend order (Subscription Credits first, soonest-expiring first), a non-rollover expiry job, and tax and consent wording from Finance/Legal before launch.
- **Veyrnox Publish plans and entitlements.** Entitlement model accepted (ADR-0062); plan pricing accepted too (ADR-0063). Composer, scheduling and connect flows for five networks are built; remaining work is review approval, metering and billing.
- **Social Cinema activation.** Foundations, creator onboarding, review, publication and the viewer paywall are built behind flags. Still to do: production activation steps (PR [#369](https://github.com/aljobson/Veyrnox.ai/pull/369)), personal cloud imports ([#364](https://github.com/aljobson/Veyrnox.ai/pull/364)) and staging-to-production rollout.
- **Cheaper wholesale supply.** BytePlus ModelArk adapter for Seedance is staged inactive (ADR-0058); activation is blocked on pack-safeguard prerequisites and supplier terms. Supplier volume quote pack in review ([#398](https://github.com/aljobson/Veyrnox.ai/pull/398)). Continue verify-then-activate for kie and GrsAI swaps, each repriced to the 50 percent margin target (ADR-0037).
- **Migration ledger hygiene.** Keep one apply path (ADR-0023) and keep `migration-ledger` green.

## Later: waiting on a trigger

- **Mobile sales channels** (iOS App Store, Google Play), each with its own Merchant of Record and Credit Pack prices. Waiting on the channel decision.
- **Passkeys** (ADR-0032, proposed). Waiting on the Supabase project setting and confirmation of the verify request bodies.
- **Media authenticity** (ADR-0025, proposed). Publish our own provenance first; vendor detection only for a named customer.
- **Face filters** (spec set exists in `docs/face-filters/`). Upload spine is built; the rest depends on the authenticity decision.
- **Video Enhance** (local prototype, PR [#361](https://github.com/aljobson/Veyrnox.ai/pull/361)). Needs a decision on a production render path.
- **Reserve/settle accounting and organisation budgets**, and moving generation and media from user-owned to project-owned (`docs/architecture/target-state.md`).
- **Cloudflare Workflows/Queues** for durable generation and rendering, replacing request-Worker orchestration.
- **Further audit remediation** tracked in `docs/operations/audit-remediation-2026-09-26.md`.

## Calendar items

| Date | Item |
|---|---|
| 2027-03-24 | Sign in with Apple client secret expires; rotate beforehand (no probe catches a miss), ADR-0030 |

## Not doing

- **Auto-refill** of credit packs. Not offered (`CONTEXT.md`).
- **Wallet, on-chain or crypto payout features.** Separate company and repo; enforced by the hard wall.
- **LemonSqueezy.** Refused the account; Stripe replaced it (ADR-0031).
- **Voice cloning** until AAL2, consent, revocation and ownership verification exist.
- **Manual credit grants** outside `ledger_grant` with a written ADR.
- **Raising the CSP's allowed hosts** without an ADR.

## Updating this file

Move an item to the changelog when it ships. Add an item only with a linked issue or ADR. Change order only with the product owner.

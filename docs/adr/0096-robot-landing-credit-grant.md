# ADR-0096 — Admin credit grant for the landing-page robot revision

- **Status**: Accepted (2026-10-11)
- **Decider**: Product owner, Al Jobson, explicitly in chat
- **Related**: ADR-0022, migration 0073 ledger grant idempotency; PR #900

## Context

The product owner requested a revised landing-page robot video: smooth armor without nipple-like details, two glass strikes followed by a forward head-and-shoulder breakout, and a large foreground question projected above the extended fingertip. The signed-in account had zero Credits after the previous portrait render. The owner explicitly requested adding 100 Credits through Supabase instead of completing a Stripe purchase.

The account was matched by its visible job `03e87196-4854-4758-8799-47c15696a7a4` and the corresponding 17-Credit ledger debit. Production configuration and the database identify the account as the owner's existing administrator account. Its balance and the sum of its ledger entries both equal zero; it has no freeze or hold.

## Decision

Grant this account 100 non-expiring paid-equivalent Credits once, through the existing `public.ledger_grant(uuid, integer, text, text)` function in production project `xdxdzmsztyzbnzeforxx`.

- User ID: `3e3dfd74-a099-4c1b-8bb4-8a336d4f1895`.
- Amount: 100 Credits.
- Reason: `grant:manual Al Jobson robot landing fingertip revision`.
- Idempotency key: `codex-robot-fingertip-20261011-01`.
- Intended use: two Kling 3.0 Pro image-to-video renders at 28 Credits each, 56 Credits total, to create the owner's landing-page assets.

This is an administrative grant, not a paid Top-up or revenue. The grant funds real provider calls. No payment record is fabricated, and customer pricing, schema and authorization remain unchanged.

## Verification

After execution, read back the grant row and balance; verify exactly one matching keyed grant, a +100 delta with free_delta zero, and balance equality with the sum of the account's ledger deltas. Confirm the 100-Credit balance in the live studio before submitting generation. Record the returned ledger entry ID below.

## Execution

Granted once through `public.ledger_grant` on 2026-10-11. Ledger entry `4391de4c-b95b-4e57-87ad-5126fe33791e` has delta +100 and free_delta 0. Read-back verification found exactly one matching grant and balance = ledger sum = 100. The live Credits page and Create studio both displayed 100 Credits before generation.

The two five-second Kling 3.0 Pro I2V renders completed successfully: portrait job `d61b8b60-1fe7-4bc8-93e0-640ded264d19` and landscape job `57859cc3-6b6e-47a4-8abf-8663faeeb06c`. Each consumed 28 Credits, leaving 44 Credits.

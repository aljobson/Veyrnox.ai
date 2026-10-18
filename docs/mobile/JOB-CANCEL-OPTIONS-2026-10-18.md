# Job cancel: options for the owner (not an ADR yet)

**Status:** Draft 2026-10-18, for a decision. Nothing is built. `app/api/v1/jobs` has `GET` list, `GET [id]` and `GET [id]/asset` only; there is no cancel route, on web or mobile. The mobile Create screen (M10a) keeps its Cancel button hidden until one exists.

## Why it is not just a button

A job debits credits when it is submitted (`ledger_debit`) and the money comes back only through the failure path (`job_failed`, then `ledger_refund`; see `lib/falWebhookHandler.js`, `lib/clipEdit.js`, `lib/chatTurn.js`). The provider keeps working on a job we stop caring about, and a finished provider result for a job we already refunded would let the user keep the output for free. Anything we build has to settle that race.

## Options

| | What it does | Money | Risk |
|---|---|---|---|
| **A. No cancel (today)** | The user waits or leaves; the job finishes or fails and refunds on failure. | Unchanged | App feels stuck on slow video jobs; users double-submit. |
| **B. Hide, don't cancel** | A "stop waiting" button that only stops the screen polling. The job still completes and lands in the Library. | Unchanged, credits are spent | No server work; honest label needed ("keeps running in the background"). |
| **C. Cancel before the provider starts** | Cancel only while the job is queued on our side (before `job_submitted` reaches a provider). One RPC: mark cancelled, `ledger_refund`. | Full refund, no provider cost | Narrow window; most jobs are handed to the provider at once, so it helps little. |
| **D. Provider cancel plus refund** | Call each provider's cancel endpoint where one exists, then refund only if the provider confirms. A late result is discarded. | Refund on confirmation; if the provider ignores the cancel we may pay for work we refunded | Per-provider code (fal, kie, GrsAI, BytePlus, OpenRouter) and a new job state; needs a sweep for "cancel requested but not confirmed". Which providers expose cancel is **not verified** here; the fal adapter in `packages/adapters/fal.js` has no cancel call. |

## Recommendation

Ship **B** now in the app (no server work, no money change), and treat **C then D** as a separate server slice with its own ADR that must answer: the new terminal state, who may cancel, what happens to a result that arrives after a refund, how `reconcile_balances()` stays at zero, and per-provider cost on a cancelled job. Do not build D before the provider cancel behaviour is tested with a capped probe on staging (label it STAGING / capped when run).

## Decision needed from the owner

1. Is B acceptable for the first store release? (Recommended: yes.)
2. Should C or D be scheduled, and for which providers first?

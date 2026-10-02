# ADR-0066 — Jev classifies provider submit refusals

- **Status**: **Proposed 2026-10-02.** Ships with `JEV_SUBMIT_ERRORS_MODE` set to `off` in
  production and staging. Turning it to `shadow` or `enforce` is the owner's decision, after
  the `TYPESAFE_API_KEY` secret is set.
- **Date**: 2026-10-02
- **Deciders**: Product owner
- **Related**: #117 (typed `error_code` on submit rejection), `lib/submitRejection.js`,
  `lib/jev.js`, `lib/submitFailureClass.js`

## Context

When fal or kie refuse a submit, the adapter returns a log string (`fal 422: {...}`,
`kie 400/422: msg`), not a code. `refundRejectedSubmit` records any untyped refusal as
`provider_submit_failed` and the route answers `502 provider_submit_failed`. A prompt the
provider refused on content-policy grounds therefore reached the user as an outage, and nothing
on the create page explained it: `provider_submit_failed` had no copy at all, and the
`moderation` copy never matched the `provider_moderation` code the grsai and byteplus adapters
emit.

Jev (TypeSafe AI's System One model, `jev-1.13.0`) answers typed questions about a text state
in roughly 0.1 to 0.5 s for $0.042 per million input tokens. A single choice question over the
vendor text can separate a content-policy refusal from bad input and from everything else.

## Decision

1. `lib/jev.js` is the only Jev client: one `fetch` to the constant host
   `https://api.typesafe.ai`, the model pinned to `jev-1.13.0`, a 1.5 s timeout, no retries,
   and the state cut to 4000 characters. Every failure (no key, timeout, non-2xx, no
   `answers`) returns `null`. It logs status codes and error names, never the state.
2. `lib/submitFailureClass.js` asks one choice question: `content_policy`, `invalid_input` or
   `other`. A label at probability 0.8 or higher becomes `provider_moderation` or
   `provider_input_rejected`; anything else, and every `null`, keeps
   `provider_submit_failed`. Only a provider's own non-2xx answer (`fal 422: ...`,
   `kie 400/422: ...`) is sent: transport errors and the adapters' local validation strings
   never leave the Worker. The classifier catches everything and returns `null`, because it
   runs in front of the refund.
3. Only refusals with no typed code are classified. A code the adapter already set
   (`provider_payment_required`, `script_refused`, ...) is never overridden.
4. The two new codes answer `422` with the code; everything else keeps `502
   provider_submit_failed`. The create page has copy for all three.
5. `JEV_SUBMIT_ERRORS_MODE` is `off` (no call), `shadow` (call and log the label, keep the
   generic code) or `enforce`. Anything else is `off`. The log line holds the mode, label,
   probability and latency only.

### Money

None. The refund is `ledger_refund(..., 'refund:submit_failed')` with the same arguments
whatever Jev answers, and it runs after the classification. A Jev timeout adds at most 1.5 s
to a request that has already failed. If the Worker is cancelled during that wait, the job
stays DEBITED and `sweep_stuck_jobs` (0018) refunds it, the same backstop as for any refund
error today. A wrong label changes only the stored `error_code` and the copy the user reads.

Jev must not be put on any path that moves money or freezes an account: `ledger_debit`,
`ledger_refund`, `credit_top_up`, `apply_top_up_refund`, `apply_dispute_event`,
`unfreeze_account`, the takedown freeze, or the operator refund and reverse actions.

## Consequences

- **Data:** in `shadow` or `enforce`, vendor error text goes to TypeSafe. fal's 422 detail
  can echo the request inputs, so this may include a prompt. TypeSafe becomes a
  subprocessor for that text: its agreement says customer data is not used for training
  without consent, gives no retention period (zero retention is enterprise-only), and states
  no data region. The privacy notice needs a line before `shadow` is turned on in
  production. Cloudflare Workers AI hosts the same model (`typesafe/jev`) with zero data
  retention and would remove TypeSafe as a subprocessor; switching to it is a change inside
  `lib/jev.js` only.
- **Rollout:** set the secret, run `shadow` and compare the logged labels with the vendor
  text in the provider dashboards for a week, then `enforce`.
- **Follow-ups this unlocks:** kie's poll path drops `failMsg` and stores a numeric
  `failCode` (`packages/adapters/kie.js`), and BytePlus guesses moderation with a regex.
  Both can use the same classifier. Prompt screening before the debit is a separate decision
  with its own ADR.

## Considered options

- **TypeSafe JS SDK (`@typesafe-ai/sdk`).** It has no dependencies and bundles on Workers, but
  its defaults (10 s timeout, 2 retries) suit a batch job, not a request path, and one POST
  does not need it.
- **More regexes on vendor text.** This is what BytePlus does. Each vendor phrases refusals
  differently and changes them without notice, so the patterns drift silently.
- **Self-hosted Laya** (an Apache-2.0 model with the same API). It needs a Container with
  8 GB of RAM and a Durable Object, which Workers Builds preview uploads refuse.
  That's not worth it for one low-volume use.

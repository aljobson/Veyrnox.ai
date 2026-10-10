# One-image staging callback validation after tenant configuration

Status: prepared, explicitly approved and executed once on 10 October 2026.
See the [live evidence and unmeasured assertions](fal-post-tenant-callback-evidence.md).
The approved one-image budget is consumed; no further generation is authorized.
[ADR 0075](../adr/0075-fal-submit-outcomes.md) requires: “a paid live test needs a
bounded approved spend.”

## Purpose and bound

Check that the ordinary staging generation path accepts one request and stores
its signed callback after the application Worker was configured for aljobson's
webhook tenant, `github|nwp4eyxnrejkmv4b2jd0wxvw`. A successful correlated request
in aljobson's history and a processed callback provide current account evidence
without revealing either API key.

| Setting | Prepared value |
| --- | --- |
| Application | `https://veyrnox-ai-staging.al-jobson.workers.dev/app/create` |
| Database | `yrqzwqywxfesmbvhzjgj` |
| Actor | Authenticated owner session `al.jobson` |
| Model | `flux-2-pro`, provider endpoint `fal-ai/flux-2-pro` |
| Maximum submissions | One application job; one press of Generate; no fresh resubmission |
| Output | One image; no uploaded input media |
| Staging credit allowance | Two credits total |
| Expected fal usage | Approximately $0.03 for the one default-size image |
| Prompt | `A small blue ceramic teapot on a plain white background.` |

The [current fal schema](https://fal.ai/models/fal-ai/flux-2-pro/api) defaults to
`landscape_4_3`. The ordinary adapter sends the supported prompt/seed fields;
this plan does not claim that route pins an explicit 1024-by-768 payload.
[Current pricing](https://fal.ai/models/fal-ai/flux-2-pro) charges $0.03 for the
first output megapixel. Recheck the model, payload defaults and price before
submission; stop if they invalidate this estimate or the two-credit bound.

No credit purchase, production request, fault injection, migration, credential
change or dispatch activation is part of this sample. The capacity policies
remain disabled. It tests direct submission and callback storage, not queued
dispatch, transport recovery, global admission or throughput.

## Preflight evidence and execution checks

At 11:19–11:21 UTC, Agent Reach's Chrome backend showed aljobson with 0/10 active
requests and $2.95 available, with auto top-up off. The dashboard warns that
balance updates may lag recent usage by up to an hour. The staging UI showed
719 credits, one selected Flux.2 [pro] image and a two-credit total; Generate was
not pressed. These observations are recorded in the
[release review](fal-release-readiness-review-2026-10-10.md).

At 11:27 UTC, Cloudflare showed intervening manual deployments: production
`cf75e015` and staging `3ee58791`, each Ready at 100% traffic. Runtime settings
still matched the disabled flags below, with both FAL_KEY and
FAL_WEBHOOK_USER_ID present as encrypted secrets. These later revisions, rather
than the original tenant-update versions, need correlation with the live sample;
binding names alone cannot establish their secret values.

Before the approved submission:

1. Recheck the authenticated staging origin, actor, selected model, one-image
   count, prompt and two-credit total. Capture the existing Library count and
   the request/job identifier when the single submission is made.
2. Read active application Worker revisions and flag values. Expected production
   flags are schema, durable dispatch, queue publication and submit outcome all
   false; expected staging is schema true and the other three false. The last
   tenant-update versions were production `52ad117b` and staging `6d193a5b`.
   An intervening deployment needs assessment; masked secret names cannot prove
   current key attribution. Do not retrieve secrets to resolve it.
3. Refresh database counts and aljobson's concurrency/balance before submitting.
   Both capacity policies should remain disabled, with zero held reservations
   and zero READY/STARTED/UNKNOWN dispatches. Confirm sufficient shared-account
   headroom for this one request. Separate database locks do not enforce a shared
   account limit, and montage or composite producers can change headroom.
4. Record other nonterminal work without cancelling it. The 11:21 staging check
   included a newly SUBMITTED video-agent job; zero direct fal jobs did not mean
   all producers were idle. A prior health snapshot is not its completion proof.
5. Start counts-only callback observation through authorized Worker logs or
   provider delivery evidence if available. CLI Cloudflare authentication was
   expired during preparation; do not claim a tail ran unless it actually did.
   Keep credentials, raw bodies, signatures and signed media URLs out of reports.

## Procedure and acceptance

After the bounded approval and fresh checks pass, press Generate exactly once.
Record the returned application job ID and its fal provider handle. If the
browser request fails or acceptance is ambiguous, preserve the existing job,
inspect Library and provider evidence, and stop without another paid submission.

Observe the job through completion with read-only queries and the authenticated
Library. A pass requires the same job to be STORED, a matching fal handle in
aljobson's history with the staging callback origin, one processed fal
`webhook_events` record, one stored `assets` record, and exactly one two-credit
`ledger_entries` debit with no refund for that successful job. Open its Library
item and confirm the image renders. Check the private asset's accessible
delivery path where supported; report an independent object HEAD as unmeasured
if it cannot be observed.

Report callback HTTP status only if observed in logs or provider delivery
evidence. STORED and a processed event establish successful application
processing through the configured verifier, but do not establish provider
redelivery, repeated-success deduplication or a measured response status alone.
Account balance movement cannot isolate this sample's cost while other producers
run; retain request-specific usage evidence if available.

Finish with a fresh staging recovery/reconciliation observation, record any
remaining work and confirm activation flags and disabled policies are retained.
Record failures honestly; never weaken authentication, reset ambiguous work,
change credentials or retry with a new job to obtain a pass.

## Remaining release gates

This sample would close only the post-tenant ordinary callback check. The full
health-window review, PR #795 merge authorization, shared-account capacity
design and production canary approval remain separate gates. Independent
staging and production policy locks and pauses do not cover one account or
external montage submitters; broader activation needs a design covering all
submitters or an explicitly reviewed operational partition.

The original preparation was documentation-only. The subsequent live sample
has browser, callback and database evidence in the linked report; no Reticle
verdict is claimed, and its unmeasured provider-history/billing assertions remain
explicit.

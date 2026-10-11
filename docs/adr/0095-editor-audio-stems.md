# ADR-0095: bounded vocal/instrument separation

Date: 11 October 2026
Status: preparation; production feature flag disabled

The owner requested the remaining editor features and uses FAL/KIE already. When asked to verify the FAL Demucs public rate against billing evidence, the owner answered "proceed". This records that explicit exception to the repository invoice prerequisite: the public advertised rate is the basis for preparation; no invoice or actual billed-cost verification is claimed. The exception does not approve production SQL through another path or assert provider output quality.

## Contract

Use the existing FAL account and `fal-ai/demucs` with the documented `htdemucs_6s` model, MP3 output and exactly six labels: vocals, drums, bass, other, guitar, piano. FAL's [model page](https://fal.ai/models/fal-ai/demucs) was rechecked on 11 October 2026 and lists $0.0007 per audio second. At the inspected 120-second input ceiling the maximum advertised cost is $0.084. One flat six-credit catalog unit preserves the existing margin floor. Normal catalog quote, source inspection, consent, debit, idempotency and refund paths apply. The client supplies neither a rate nor a trusted duration.

The webhook accepts exactly the declared six outputs, verifies provider source boundaries and copies them to owned storage. An atomic, service-only RPC stores all six unique labelled assets together; retries with the same manifest are idempotent and conflicting/partial manifests fail. Owned short-lived reads select an allowlisted stem, preserve expiry and job-wide held-content checks, and reveal no outsider file. Ordinary generation lookup retains its existing contract. Each chosen stem inserts as an independent audio source with a stable saved-project/Library reference. Downloads and reopening use fresh owned URLs.

`EDITOR_AUDIO_STEMS_ENABLED` remains off in production (no binding; both guards require exact `true`) and true in staging preparation. A disabled flag marks the model gated in the public catalog, excludes it from the editor generation picker and refuses generation before debit. Migration 0291 must be reviewed and applied only through the owner-approved main migration workflow. Actual billed-cost evidence and successful hosted separated-audio inspection remain outstanding; this preparation does not qualify lyric accuracy, stem leakage, commercial catalog licensing or full CapCut parity.

## Qualification

The checked-in official OpenAPI fixture and focused tests cover payload/output contracts, named-stem routing, result identity, copying/refund/retry and public-catalog/generation guards. A fresh isolated Postgres rebuild applies the migration with the rest of the schema; transactional database journeys exercise atomicity, idempotency, access grants/RLS, owner lookup, held/expired behaviour and ordinary model compatibility. See [the separation verification record](../editor/AUDIO-STEMS-VERIFICATION-2026-10-11.md) for exact results and outstanding hosted qualification. No paid provider request is made by those tests.

## Worker binding capacity — preparation history

The first exact-head Cloudflare build compiled successfully but its preview upload refused 129 text bindings (Cloudflare error 10055, limit 128). Existing application and scheduled-worker bindings are retained. Preparation omits only the new false-valued production stem binding: undefined is explicitly tested as gated, and the generation handler requires exact `true` before debit. Staging retains its own true value. Production activation must first allocate binding capacity; no existing secret or active feature gate is removed to make this build pass.


## Pre-launch testing and capacity amendment

The owner requested all implemented editor features on the production URL for
pre-launch testing, and clarified that there are no public users yet. Migration
0291 was subsequently owner-approved in run 38162754740 and applied with receipt
20261011181947; this does not establish a complete observation window.

The follow-up runtime configuration groups Library exports, organization and
local inference in one strictly validated `EDITOR_RUNTIME_FLAGS` text binding.
Their current true values remain true. The independent audio-stems value remains
false. This frees two text bindings without removing an existing secret or
changing the other paid/upload/publishing gates. Explicit legacy values override
the group, including false for rollback; malformed/unknown values fail closed.
Public catalog cache keys include the effective audio-stems state so activation
and rollback do not share a stale model-gating cache entry.

Automatic approval review rejected a bundled paid separation activation because
the provider/billing exposure was not specifically authorized or qualified.
The accepted alternative retains the paid flag as false. A separate focused
activation requires explicit owner approval of that resulting provider spend;
no paid request is submitted by this amendment.

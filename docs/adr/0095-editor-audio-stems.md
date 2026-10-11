# ADR-0095: bounded vocal/instrument separation

Date: 11 October 2026
Status: preparation; production feature flag disabled

The owner requested the remaining editor features and uses FAL/KIE already. When asked to verify the FAL Demucs public rate against billing evidence, the owner answered "proceed". This records that explicit exception to the repository invoice prerequisite: the public advertised rate is the basis for preparation; no invoice or actual billed-cost verification is claimed. The exception does not approve production SQL through another path or assert provider output quality.

## Contract

Use the existing FAL account and `fal-ai/demucs` with the documented `htdemucs_6s` model, MP3 output and exactly six labels: vocals, drums, bass, other, guitar, piano. FAL's [model page](https://fal.ai/models/fal-ai/demucs) was rechecked on 11 October 2026 and lists $0.0007 per audio second. At the inspected 120-second input ceiling the maximum advertised cost is $0.084. One flat six-credit catalog unit preserves the existing margin floor. Normal catalog quote, source inspection, consent, debit, idempotency and refund paths apply. The client supplies neither a rate nor a trusted duration.

The webhook accepts exactly the declared six outputs, verifies provider source boundaries and copies them to owned storage. An atomic, service-only RPC stores all six unique labelled assets together; retries with the same manifest are idempotent and conflicting/partial manifests fail. Owned short-lived reads select an allowlisted stem, preserve expiry and job-wide held-content checks, and reveal no outsider file. Ordinary generation lookup retains its existing contract. Each chosen stem inserts as an independent audio source with a stable saved-project/Library reference. Downloads and reopening use fresh owned URLs.

`EDITOR_AUDIO_STEMS_ENABLED` remains false in production and true in staging preparation. A disabled flag removes the model from the public catalog and refuses generation before debit. Migration 0291 must be reviewed and applied only through the owner-approved main migration workflow. Invoice verification and successful hosted separated-audio inspection remain outstanding; this preparation does not qualify lyric accuracy, stem leakage, commercial catalog licensing or full CapCut parity.

## Qualification

The checked-in official OpenAPI fixture and focused tests cover payload/output contracts, named-stem routing, result identity, copying/refund/retry and public-catalog/generation guards. A fresh isolated Postgres rebuild applies the migration with the rest of the schema; transactional database journeys exercise atomicity, idempotency, access grants/RLS, owner lookup, held/expired behaviour and ordinary model compatibility. See the test logs and the forthcoming release record for exact results. No paid provider request is made by those tests.

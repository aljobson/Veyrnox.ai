# ADR-0027 — The gateway builds provider requests from a capability registry

**Status:** Accepted 2026-09-22
**Related:** [Registry spec](../model-capability-registry/SPEC.md), [ADR-0020](0020-kie-and-openrouter-providers.md) (kie.ai and OpenRouter), CLAUDE.md "Money & billing"

## Context

What a user may buy, and what we send the provider for it, was spread over
three places: `DURATION_FIELDS`, `DEFAULT_PINS` and `PAYLOAD_SHAPES` in
`lib/providerDuration.js` (prefix-matched on the endpoint), the kie and
OpenRouter adapters, and a hand-kept `durations` list in `tokens.js`.
Anything no table mentioned went to the provider untouched.

That gap cost money. fal bills on parameters we never priced: Wan 2.5 at
its default 1080p ran at a 42% loss, Kling 2.6 billed audio we did not
charge for, and Hailuo's 5s clip is really 6s. Each was fixed by adding a
pin (0083), but the default was still "forward it", so the next new model
or new provider parameter would leak the same way. Kling 3.0 i2v was
switched off (0081) because the old tables sent its start frame under the
wrong field name.

## Decision

1. **One record per endpoint** in `lib/modelCapabilities.js`: provider,
   kind, declared inputs (type, enum, max), renames, reference-media slots,
   sellable lengths and the provider field that carries them, pinned values,
   and billing assumptions. `lib/providerDuration.js` is deleted.

2. **No record, no generation.** An active catalog row whose
   `provider_endpoint` has no record, or whose record names a different
   provider, gets `501 provider_unsupported` before any debit, and
   `/api/catalog` leaves it out. Adding a model now means adding a record.

3. **Undeclared keys are dropped, not forwarded.** The create page sends one
   control set (`prompt`, `aspect_ratio`, `duration_seconds`) for every
   model, so refusing unknown keys would break Hailuo, Flux, Seedream and
   the audio models. The gateway keeps only the keys the record declares
   (plus `duration_seconds` and the model's own media slots) and uses that
   set everywhere after the lookup: the pre-debit check, the price, the
   `jobs.inputs` written by `ledger_debit`, and the provider request.
   A declared key with a bad value is still refused before the debit.

4. **The catalog publishes the contract.** `/api/catalog` returns
   `durations` (from the record) and `capabilities`: inputs, enum values
   and reference slots. It never returns provider field names, pins or
   assumptions.

5. **Guards:** `tests/fixtures/capability-payloads.json` pins the exact fal
   payloads the old builder produced; every captured case must shape
   identically. `scripts/check-capabilities.mjs` compares each fal record
   with the live OpenAPI schema and flags any billed parameter that is
   neither pinned nor assumed; it runs in `fal-catalog-watch.yml`.

## Consequences

- A user who sends an undeclared key (for example `seed`, or an
  `aspect_ratio` to an audio model) is charged the same and gets the same
  result as before; the key is simply not stored or sent. Before, fal
  ignored most of these, but a billed one would have been forwarded.
- `jobs.inputs` for new jobs holds only declared keys, so support and
  audits see what was actually requested of the provider.
- The kie and OpenRouter adapters still build their own request bodies; the
  record check runs first and a test holds the two in agreement. Moving
  their shaping into the registry is later work.
- Kling 3.0 i2v stays inactive until a live image-to-video test passes
  through the new path; its reactivation is a separate migration.
- Price is unchanged: `model_catalog.credits_5s` is still normative, and the
  record only decides which requests that price covers.

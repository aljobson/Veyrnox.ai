# Swap privacy-register entry

Date: 2026-11-07. Status: inactive; owner review required before activation.
Related: ADR-0329, ADR-0317 and [sub-processors](sub-processors.md).

| Flow | Categories | Purpose | Recipient |
| --- | --- | --- | --- |
| Swap · Pro | Customer source video (including any soundtrack), one or two reference face photos, optional replacement prompt and generation settings | Replace the depicted person using the supplied reference | Existing processor fal, hosted MiniMax H3 Max Recast |
| Swap · Quick | Customer source video (including any soundtrack), one reference face photo and generation settings | Replace the depicted person using the supplied reference | Existing processor Crun, hosted Wan 2.2 Animate replace |

These are new categories/use cases for already inventoried processors, not new
processor registrations. Each job goes only to its selected provider; neither
model is a fallback for the other. Ownership checks, short-lived signed media
URLs, rights attestation, asset storage/erasure and existing retention paths are
reused. No face identity index or reusable face profile is introduced.

Proposed purpose/basis: customer-requested generation / contract, subject to
owner and counsel review. The notice asks customers to use photos of people who
agreed; it is not identity verification or a legal-compliance certification.
No new retention period is promised. Existing upload/generated-asset retention
and holds apply; provider retention, locations, training use, transfer mechanisms
and DPA coverage for face photos remain UNKNOWN — owner to confirm before
activation. Confirm Crun's documented 14-day media handling against its contract.
Both catalog offers remain inactive pending that review and billing proof.

## Scene source extension (inactive, 2026-11-07)

A scene can supply a server-held vetted source clip (including soundtrack)
instead of a customer-uploaded video. The customer supplies only the reference
photo(s). The recipient and purpose remain the selected Swap offer above.
Before any clip enters the manifest, record its provenance, owner approval,
per-clip moderation/AUP decision and rights covering reuse, soundtrack and
any depicted person's likeness. A clip containing a person's likeness needs
its own rights record; the customer's photo consent does not cover that clip.

The shipped registry and manifest are empty. No clip or preview is imported
or published. Later imports must separately verify conservative duration,
visual coverage, dimensions, MP4 type, immutable version and SHA-256. Provider
access uses a server-only signed URL lasting at most fifteen minutes. Job
identity keeps the scene/version/hash; public config exposes none of those
private source facts. Shared clip retention is separate from disposable
customer uploads and must be decided before import/activation; no retention
period or rights clearance is implied by this implementation.

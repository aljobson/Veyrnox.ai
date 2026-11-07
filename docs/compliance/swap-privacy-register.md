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

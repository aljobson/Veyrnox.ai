# ADR-0330 — Source-rights statement is accepted through the Terms, not a checkbox

Status: accepted (owner, 2026-11-07).
Date: 2026-11-07.

## Context

Attaching a file to a generation asked for a per-generation tick: "I own this
file, or I have the permission of everyone identifiable in it…". The owner
judged it added friction and screen space without value, since the person has
already accepted the Terms of Service. The PR gate noted that the gateway
still records an explicit confirmation on the job (0096, 0146).

## Decision

1. The checkbox is removed on web and mobile. Attaching a file is the
   confirmation; clients send `consent: true` whenever a source is attached.
2. The statement now lives in Terms section 4 and the Acceptable Use Policy
   ("You must have the rights to what you upload"), which say plainly that
   attaching a file confirms it and that the confirmation is recorded against
   the generation and the account.
3. `RIGHTS_ATTESTATION_VERSION` becomes `terms-2026-11-07`, so the record
   shows these were made under the Terms-based wording, and users re-attest
   under it on their next upload. Earlier rows keep `aup-2026-09-26`.
4. The separate AI-sharing consent (ADR-0128) and the Publish and Cinema
   creator rights declarations are unchanged.

## Consequences

- A job's recorded consent now means "attached a file under these Terms", not
  "ticked a box". Auditors should read `rights_attestation_version` accordingly.
- Non-English legal text is machine-written and needs native and counsel review.
- If an explicit acknowledgement is wanted later, reintroduce it once (first
  upload) rather than per generation, under a new version.

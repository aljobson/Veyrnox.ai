# ADR-0017 — C2PA claims withdrawn until signing is built

- **Status**: Accepted (2026-09-12)
- **Date**: 2026-09-12
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0005 §5 — EU AI Act (Article 50) transparency](0005-phase-0-business-preconditions.md), [ADR-0016 — Data-residency claim correction](0016-data-residency-claim-correction.md)

## Context

ADR-0005 §5 chose "watermark + metadata + ToS notice" for Article 50
transparency and put a C2PA library on the **Phase-4 task list**. The marketing
copy shipped as though Phase 4 had already happened.

C2PA was asserted in twelve places: a landing hero line, a "Why Veyrnox" pillar,
a full-width feature strip, two metric strips, the footer tagline, an FAQ answer,
the Terms of Service, the GDPR page, and the sign-up consent block.

Nothing implements it. There is no C2PA dependency in `package.json`, no signing
or manifest code anywhere in `app/`, `lib/` or `packages/`, and the delivery path
in `app/api/webhook/fal/route.js` copies the provider's bytes into R2 unmodified.
The strongest claims were the legal ones: the Terms told users they "must not
remove or alter those credentials", and the GDPR page called C2PA credentials
"required by EU AI Act Article 50".

Two things were wrong with the legal wording beyond the missing implementation.
A contractual obligation was placed on users in respect of something we do not
produce. And Article 50 requires machine-readable marking of synthetic content;
it does not mandate C2PA specifically, so naming a commercial standard as legally
required overstated the law.

## Options considered

### A. Build C2PA signing now

Sign each asset during the webhook store step before the R2 upload.

- Effort: days. A signing library that runs in workerd, a certificate and its
  key management, per-format manifest embedding for image, video and audio, and
  a verification story.
- Risk: real work, blocking a copy correction that should take an hour.

### B. Withdraw the claims until it ships

Remove every C2PA assertion; replace the marketing slots with claims the code
backs; state plainly in the legal pages that we do not attach credentials today.

- Effort: about an hour.
- Risk: loses a differentiator the product never actually had.

## Decision

**Option B.** The claims are withdrawn.

Marketing replacements are all backed by shipped code: the fourth pillar and the
feature strip now describe the append-only ledger, the hero stat becomes the
cheapest real generation price (1 credit), and the metric strip names the ledger.

The legal pages now say we do not currently attach content credentials, that a
provider may embed its own watermark outside our control, and that the user is
responsible for any labelling a platform or applicable law requires of them. The
"must not remove or alter" obligation is retained conditionally, taking effect
only if we begin attaching credentials.

## Consequences

- No customer-facing surface claims provenance signing any more.
- **Article 50 is now an open compliance question, not a solved one.** The
  obligation on providers of generative systems to mark synthetic content in a
  machine-readable format applies from August 2026. Veyrnox.ai does no marking
  today, and shifting the labelling duty to the user in the Terms is a statement
  of fact about our system, not a transfer of a provider-side obligation. This
  needs a decision: build the marking, or take advice on exposure.
- ADR-0005 §5 stays open. Its Phase-4 C2PA task is still the plan of record; this
  ADR only stops the copy from claiming it is done.
- Some providers (Google's Veo among them) embed their own watermarks. Claiming
  that as ours would be the same mistake in a different costume, so the copy
  attributes it to the provider and does not lean on it.

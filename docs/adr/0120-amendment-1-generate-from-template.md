# ADR-0120 amendment 1 — Generate from the template page

**Status:** Proposed 2026-11-06
**Related:** [ADR-0120](0120-mobile-templates.md) (mobile templates), [ADR-0325](0325-exact-only-community-templates.md) (exact prompts), the Create submit (`useStudioJobs`, `createGenerationSubmit`)

## Context

A person who picked a template had to press "Use template", land on Create, and press Generate there. The owner found the second page confusing. Create already holds everything a generation needs; a template that needs no picture, clip or described voice needs none of Create's attach controls.

## Decision

1. **A template that needs no media gets a primary Generate on its own page** (web `/presets/:id`, mobile `templates/[id]`). It sends what Create sends for that template with nothing attached: the template's prompt (as edited on the page), the model, length and shape chosen there, the template id as `preset`, and a per-request idempotency key. The price shown is the live catalogue price; the request carries `max_charge_credits` from the same allocation quote Create uses, so a changed price asks for a fresh confirmation instead of charging more. The result, its progress, Open (Library / the job page) and Retry are shown on the same page.
2. **No second code path for money.** Web builds the request with the same `createBatch`, `allocationSnapshot` and `sendInOrder` Create uses (`app/veyrnox/_lib/templateGenerate.js`); mobile calls the same `createGenerationSubmit` (`apps/mobile/src/lib/useTemplateGenerate.ts`). Errors use `createErrors.js` (web) and `generationMessage` (mobile). Every failure keeps Create's refund path: a refused submit is not charged, a failed job is refunded by the server, a lost reply keeps its key so a retry is charged once, a successful or definitively refused request starts a new key.
3. **Gates are not skipped.** The rights ("I own these files") tick and the server's upload `consent` exist only when a file is attached, and the inline path never attaches one. The mobile AI-provider agreement is enforced in the API client for `POST /generations`, so it applies here as it does on Create.
4. **A template that needs media keeps Create.** A template whose text says what to supply (`needs`), whose model requires a reference slot, or whose model takes a described voice or an audio length, does not get an inline Generate. It keeps "Use template", which opens Create with the template applied (its `needs` line and attach area are already shown there). Attaching on the template page is a possible later slice.
5. **"Use template" becomes "Edit before generating"** when Generate is offered, and opens Create exactly as before.

## Consequences

- Fewer steps for the common prompt-only template. Create is unchanged.
- The inline request is built beside Create's, not inside it: Create's submit is pinned by source-text tests, so the shared pieces are the batch/quote/submit primitives rather than one extracted function. A future refactor can fold the two together.

## Amendment (2026-11-06): inspiration-only templates

Some exact community prompts say to use `@video1` (source footage). Veyrnox has no video reference slot, so the model never sees that input and returns an unrelated clip. A template whose exact prompt carries the audit issue `reference-video-not-supported` is therefore inspiration only: the template page and Create show a note and do not generate (web `templateSourceBlock.js`, mobile `sourceUnsupported`). The prompt stays readable and copyable. A template that needs only the person's photo is unaffected. Supplying the source clip (a video slot) is a separate decision.

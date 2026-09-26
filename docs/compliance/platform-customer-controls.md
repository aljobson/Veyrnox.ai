# Platform Customer controls: where each one lives

BytePlus's Service Specific Terms for the Model Services, section 4.2.2, set four minimum
controls for any platform that puts video generation in front of external users. Every
payment and model provider we use asks for the same four in looser words. This page maps
each to the code and the record, so a provider review or an auditor can be answered with
file names rather than promises. Decided in ADR-0058 decision 7; built 2026-09-26.

## 1. Identity verification for end users

Our standard, stated here so a provider can accept or reject it:

- Every account is an email address confirmed by Supabase Auth before it can generate.
  The signup grant follows confirmation, not creation (migration 0071; CLAUDE.md
  "Identity & sessions").
- Sign-up and sign-in pass Cloudflare Turnstile (ADR-0026), so accounts are made by
  people, one at a time.
- Google and Apple sign-in are the alternative providers (ADR-0030); both deliver a
  verified email.
- Any paid generation requires credits bought through Stripe Checkout (ADR-0031). Stripe
  is Merchant of Record and runs its own identity, card and fraud checks; the Stripe
  customer and PaymentIntent ids sit on `top_ups`. A card dispute Freezes the account
  (ADR-0019).
- Rate limits on attempts, uploads, reads and checkout (ADR-0034 to 0041) bound what
  one identity can do per minute.

What we do not do: government ID checks. If a provider requires them, that is a product
decision recorded in a new ADR, not a gap in this one.

## 2. Security incident response process

`docs/agents/incident-response.md`: owner, provider contacts, what counts as an
incident, the contain, preserve, assess, notify, record, follow-up steps, the 24-hour
credential rotation rule and the 72-hour ICO clock. Incident notes live under
`docs/incidents/`.

## 3. Tiered violation handling with content traceability and records

| Piece | Where |
|---|---|
| Record | `account_actions`, append-only (trigger `account_actions_no_update`), actions `warning`, `takedown`, `freeze`, `unfreeze`, `dispute_resolved`; `job_id` column links a strike to the exact generation; `actor` is the admin's email; `reason` is required. Migration 0146. |
| Write path | `record_content_violation(p_auth_id, p_user_id, p_job_id, p_tier, p_reason)` RPC. Checks `users.is_admin` itself. A takedown deletes the job's `assets` rows and queues their R2 keys for the reaper, so the content stops being served in the same transaction. The third takedown calls `freeze_account` with reason `content:third_takedown`. |
| Read path | `list_content_violations(p_auth_id, p_user_id, p_limit)` RPC, newest first, with the user's email and the job's model. |
| Operator surface | `/app/admin/violations` (`app/veyrnox/app/admin/violations/page.js`): look a user up by email, user id or job id, see standing and the last 25 generations, record a warning or a per-job takedown with a required reason and a freeze notice on the third strike, and read the record. It drives `GET /api/v1/admin/users/lookup` (`admin_lookup_user`, migration 0148) and `POST` and `GET /api/v1/admin/violations` (`app/api/v1/admin/violations/route.js`), all behind middleware identity, the `ADMIN_REQUIRE_AAL2` second-factor flag and each RPC's own admin check. |
| Traceability | Every job row keeps `inputs`, `provider`, `provider_job_id`, `model_id` and timestamps; every asset keeps its R2 key and SHA-256 (`job_stored`); every provider callback is in `webhook_events`. A strike therefore points at the prompt, the provider task and the bytes. |
| Way back | `unfreeze_account(p_user_id, p_operator, p_reason)`, also logged. |

Tiers and their meaning are in the runbook's "Tiered violation handling" table.

## 4. Rights in user-uploaded content, including real-person imagery

| Piece | Where |
|---|---|
| Per-job statement | The gateway refuses any request naming an upload unless `consent: true` is sent (`app/api/v1/generations/route.js`, error `consent_required`) and records the statement on the job through `job_consent_attested` (migration 0096, `jobs.consent_attested_at`). |
| Account-level record | The same request records the statement once at account level with its wording version: `attest_upload_rights(p_user_id, p_version)` sets `users.rights_attested_at` and `users.rights_attestation_version` (migration 0146). The version constant is `RIGHTS_ATTESTATION_VERSION` in the gateway; bump it when the wording changes and users re-attest on their next upload. `GET /api/v1/account` returns both fields. |
| Wording | The create page checkbox (`app/veyrnox/app/create/page.js`): ownership or permission of everyone identifiable, no real person's face, body or voice without consent, rights to any brand, artwork or recording, and notice that the statement is recorded. It links to `/legal/aup`. |
| Upload integrity | Uploads are signed by the server, checked against what was declared at signing, and capped by the model's pixel and length limits before the debit (ADR-0028); project media is quarantined and format-inspected before use (ADR-0056). A client URL never becomes a model source. |
| Enforcement | A breach found later is a takedown under control 3, traceable to the job that carried the attestation. |

## Labelling generated output

Every asset card in the library carries an "AI generated" chip (`app/veyrnox/app/library/page.js`).
Provider metadata in the file is kept as delivered: the R2 copy is byte for byte and no
watermark or identifier is stripped (BytePlus GenAI Acceptable Use Policy; EU AI Act
Article 50 direction).

## Open items

- An email to the user on a warning or takedown. The record exists; the notice is not
  automated yet.
- BytePlus's written answers on the US exclusion and on our platform status
  (ADR-0058 "Before activating any row", items 2 and 3).

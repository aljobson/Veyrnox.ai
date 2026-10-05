# Flux KIE staging verification — 29 September 2026

## Result

One authenticated browser generation completed through the deployed gateway,
provider completion, R2 storage and library image download. This verifies the
success path; it does not establish a new live failure/refund or cron-only test.
Production activation has not been performed.

## Deployment

- Staging Worker: `veyrnox-ai-staging`.
- Version: `0d88be32-fb8d-482c-ae03-aca97a5c78f5`.
- Source: main `ffaacf9`, Cinema branch through `559234e`, and Cinema fix
  `c0230f5`, combined locally on `codex/flux-staging-integration`.
- Prior version: `acb29638-7370-4730-bed1-8f7cbe185c61`.
- All 19 deployed plain-text variables matched the combined configuration.
  Existing secrets retained. Access and MFA retained; Cinema proxy uploads off.
- 979 tests passed, one skipped; Worker build passed, including build lint.

## Live evidence

- Model: `flux-2-pro-1k-kie`, temporarily active on AI staging only.
- Job: `9e5cb73f-2f15-4b5d-9e38-fd95d93263be`.
- Provider task: `425f561988dd0bb18fa3c510f9575913`.
- Submitted: `2026-09-29T10:00:40Z`.
- Prompt: ceramic teapot on a linen cloth beside a sunlit window, realistic
  still life photograph, no text.
- Provider record: success, 54 seconds, `creditsConsumed: 5` ($0.025 at
  $0.005 per supplier credit).
- Job state: `STORED`, no error; asset
  `e9b03551-b76b-421f-bd16-f71b35c58745`.
- JPEG: 1344 × 768, 209403 bytes. The 1K designation is a provider tier,
  not an exact square pixel dimension.
- SHA-256: `8b97dc1d277ddc261d7521dc48833c87ec525f2743e753651f420e892fb97789`.
  Browser-downloaded bytes matched the stored hash.
- Exactly one ledger entry: `debit:generation`, delta -2, free_delta -2.
  Visible balance changed from 50 to 48; library showed one completed asset.
- `reconcile_balances()` and `reconcile_free_credits()` each returned zero
  mismatches after completion.

## Cleanup and remaining gate

Flux returned to inactive after completion. Dialogue remains inactive. The
successful generated asset and append-only ledger remain as acceptance evidence;
normal asset expiry is 28 December 2026. No secrets or signed asset URLs are
recorded here. No additional provider generation was submitted.

Failure/refund coverage was subsequently verified with five Flux-specific
gateway tests using real handlers and an isolated fake network. Both local
Postgres catalogue acceptance tests passed, including activation replay and
rejection of missing rows, endpoint drift, customer-price drift and supplier-price
drift. Migration 0162 is the separate guarded activation; the production workflow
still requires owner approval. Keep the fal route: its feature set differs
(KIE does not expose seed control).

# Vocal/instrument separation preparation — 11 October 2026

Current status: **enabled on production for owner pre-launch testing** after explicit paid activation approval. Production migration 0291 is applied. The historical preparation notes below retain their scope; the activation receipt at the end supersedes disabled-preparation statements. No paid provider qualification job was submitted.

## Contracts and database

The official FAL Demucs OpenAPI input/output contract is captured in `tests/fixtures/demucs-contract.json`. The public rate is linked in [ADR-0095](../adr/0095-editor-audio-stems.md), which records the owner’s explicit public-rate exception and unverified actual billed cost. Fixed six-output MP3 requests use htdemucs_6s and an inspected 120-second ceiling; six credits cover one bounded job. Existing source ownership, quote/consent/debit/refund/idempotency paths apply.

Focused Node checks prove exact payload/output contracts, named result routing, atomic copy/store retries, malformed output rejection, normal-job compatibility and six distinct unified-Library identities. A selected bass reference reopens bass, rather than silently falling back to vocals. Runtime flag tests require exact `true`, preserve independently gated rows and hide gated models from the editor selector.

A real isolated Postgres fresh rebuild applied all 271 migrations. Seven transactional journeys passed: whole-manifest validation; one atomic six-output completion; replay preservation; write-failure rollback; service-only empty-search-path RPCs and forced RLS; owner/outsider, held and expiry reads; ordinary model/asset compatibility. Fixtures rolled back. The existing CI base-schema ledger harness also passed all 360 acceptance checks in a separate UTC database; it was not run against a production database.

The final full Node suite passed **3,238 tests**, with zero failures and one existing skip. Lint has zero errors (100 existing warnings); the production webpack build passed.

## Actual local UI

Temporary development-only SDK/store wiring exposed the GenerationPanel’s actual selected mode, models, quote and submission state. Reticle explicitly verified selecting “Separate vocals and instruments” changes the Audio panel to separation, leaves the model null and the submit button disabled when live pricing is unavailable. A following assertion found no submitted job. The local API was deliberately not configured with a service key and returned 503, so this proves the unavailable-catalog refusal, **not a successful live-catalog/provider separation journey**. Catalog gating has separate contract tests.

The first panel-open check returned `no-fault/already_true` because the hidden selector already existed; it is not a pass. The explicit state-changing selection subsequently returned `verified: yes`. An earlier saved-flow replay timed out while the local editor route gate was omitted; enabling the route and restarting only the owned dev server corrected that setup. That replay has no passing result. Reticle’s negative network assertion reported buffer eviction; submission-state evidence is retained, and no all-time network-history claim is made. The raw results, including these limits, are preserved in the private release evidence. The SDK wiring was removed and the normal CSP restored before commit.

## Release requirements still open

- Green exact-head CI and a focused preparation release.
- Owner approval of the reviewed `0291_audio_stems` production-database job; actual receipt and observation evidence.
- Hosted signed-in quote/source/consent preflight, successful provider output storage, six stem imports/downloads and save/reload/export recovery.
- Independent decoding and listening/measurement against rights-cleared mixed speech/music. The contract tests do not prove vocal leakage, lyric alignment or output quality.
- A separate focused flag activation after qualification; this preparation cannot enable paid Cinema, project-media uploads or native social publishing.

Library source completeness is already live in [PR #898](https://github.com/aljobson/Veyrnox.ai/pull/898). Its [verification record](LIBRARY-VERIFICATION-2026-10-11.md) is separate from this unreleased paid operation. Broader language, licensing, native publishing and long-footage/mobile gaps remain in [the CapCut matrix](CAPCUT-GAP-2026-10-10.md).

## Worker binding capacity

The first exact-head Cloudflare build compiled successfully but its preview upload refused 129 text bindings (Cloudflare error 10055, limit 128). Existing application and scheduled-worker bindings are retained. Preparation omits only the new false-valued production stem binding: undefined is explicitly tested as gated, and the generation handler requires exact `true` before debit. Staging retains its own true value. Production activation must first allocate binding capacity; no existing secret or active feature gate is removed to make this build pass.


## Owner-approved production activation follow-up

Migration run 38162754740 completed successfully after the owner's approval;
production receipt is 20261011181947, applied 11 October at 18:19:47.4595533 UTC.
No pending migration is bypassed by this rollout. Source/capacity PR #902 merged
as 4eeaa49039c5de82c14e3749fd0629f637759fb3 after every required check and Workers
Builds passed on b6d12c183ae8f5888a042ecdc21be9f456d91732. It provides owned device
sources as well as Library sources and frees two bindings without disabling
existing controls. The owner subsequently explicitly approved the separately
priced FAL separation activation. Current release preparation sets only the
production group audioStems member to true; exact-head CI, actual deploy and
catalog/flag/UI readback follow. No paid provider request or leakage/lyric-quality
claim is included in the availability rollout.

## Actual paid availability release

The owner answered “Enable paid vocal separation” to the focused six-credit,
120-second FAL activation question. PR #904 passed every required CI check and
Workers Builds on 941ce64f91a725720bb0d418b9db219b01bb31ca and was squash-merged as
ac6f85fb206dda07f1baff033a7d52ef456264f7 at 19:06:42 UTC. Actual deploy-production
run 38166627806 succeeded; all five live smokes passed at 19:11:12 UTC, all 45
secret binding names survived, workers.dev/preview closure passed and rollback
was skipped. Deployment 2fd142ff-ebc3-4ea3-ada7-32b0f7123e05 serves version
98e50e06-ed3c-4189-b065-fdedd9a51397 at 100% from 19:10:48.724773 UTC.

Actual plaintext binding readback has EDITOR_RUNTIME_FLAGS.audioStems=true;
Library, organization and local inference remain true in that group. The
advanced workspace, shared tools and cloud documents remain true. Paid Cinema,
project-media uploads and native publishing remain false. Native production UI
readback exposes Demucs, six credits, the 120-second limit and device/Library
audio pickers. This verifies availability, not successful paid separation or
listening/output-quality qualification. Enabling ran no job automatically.

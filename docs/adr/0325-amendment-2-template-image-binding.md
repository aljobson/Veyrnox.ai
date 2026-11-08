# ADR-0325 amendment 2: bind exact template image slots

Status: Accepted by owner plan A2, 7 November 2026; implementation rounds A2-1 through A2-3.

Exact-only transport permits rewriting recognized image-slot tokens to ordered
Seedance reference tokens. All other source bytes, including whitespace, remain
unchanged. Contracts record the source hash, bound hash, occurrence mapping,
effective model and distinct slot count (one through nine). Unknown placeholders,
unsupported aspect/duration and prompt limits prevent a bound claim.

Only the active catalog can make a route available or supply its live quote.
All bound templates use the contract model from discovery onward, independently
of picker completeness. Web and mobile expose N required, labelled photo slots
with type/20 MB/known 256 px checks and remove/replace controls. A request may
carry template_id only with exactly N valid references in slot order. Handoffs
remain memory-only (at most nine photos on web; owner-scoped uploaded keys on
mobile). Custom negative-prompt settings retain their base byte behaviour;
normalization is limited to exact template transport and contract comparison.

Owner decision, 7 November 2026: higher Seedance-reference prices for all
token-bearing templates are ACCEPTED. One-photo prices change from 19 to 85
Credits / 5s and 64 to 170 Credits / 10s; multi-photo templates use the same
active reference-model quote for their duration. This is a route change, not
an edit to catalog prices or pricing configuration.

The shared video detector requires external video evidence. Generic motion,
camera, choreography and identity-preservation directions are insufficient.
Numbered video tokens, explicit source/reference/uploaded video requirements,
and reviewed unnumbered video-authority forms block before debit. Harmless edits
cannot bypass that guard; independent custom text remains a custom run.
External source audio remains unsupported and admitted with the notice; generated
native sound, dialogue and silence do not imply external audio. No active template
route accepts a preserved source-audio reference. Audit evidence and remaining
unbound IDs are in the product source-audit document and A2-1 report.

Plan step 6 authorizes equivalent exact-byte, model, price, reference-array and
fixed-audio test assertions for rerouted bound templates. Original source hashes,
consent, ownership, replay and rejection guarantees remain. The report enumerates
every changed base assertion. Non-bound, non-blocked TemplateRecipe and detail markup remains unchanged.
The owner approved effective model links/names/prices and removal of obsolete
start-frame crop hints on bound detail pages. Prose-only video-blocked recipes
show the existing source-video note; the host updated the reviewed baseline
for community-parking-lot-recast, which passes without further fixture edits. Existing edited-prompt character guidance
remains intact. No flag, migration, pricing configuration or provider activation
is changed. All results are structurally validated, not output-verified; paid
preview comparisons remain owner-gated.

A2-3: live image capability maxima gate bound photo pickers before upload on web
and mobile. Only a verified image maximum can widen the three-per-kind aggregate
source cap. Guard-failure replays require a valid key and the existing shared
rate RPC before owner/job reads. The conservative bare-token grammar accepts
capital `Image N` labels with a colon or dash; narrative quantities are not slots.
Any unresolved capital image reference prevents partial binding. Renumbered
photo slots display source-context hints in every position. Reviewed counts,
class-change IDs and verification limitations are in the A2-3 report.

A2-4 (owner-approved final bundle-fix round, 7 November 2026): the immutable full
contract remains in server guard/audit code. `templateRoutes.json` interns small
routing/UI-setting profiles (34,707 bytes; budget 60 KiB). It contains no prompt
strings, occurrence maps, hashes or reasons. The selected template's original
source comes from the existing API response; the shared binder reconstructs its
bound prompt and token map only when needed. `/api/templates/:id` includes that
single UI contract, including aspect, duration and negative prompt. Mobile keeps
API source objects separately from edited Create text and fetches one detail for
a direct Create link. Neither browser nor native code imports the full table.
The full server contract and all classifications are unchanged: 232 safe / 162
bound / 355 video-blocked / 22 unsupported. Request parity remains mandatory.

Every bound slot now displays its original source surroundings, whether or not
its number changed, using the same 40-character window on each side of the token.
These excerpts are source text; the slot labels remain translated. The server
checks `references.length === slotCount` independently of min/max metadata.

F4 decision: remove the unused mobile `requireDimensions` flag. Known dimensions
still receive the template's 256 px client check. Unknown dimensions defer to the
existing server source inspection and model capability rules. This does NOT
claim a server 256 px floor: the Seedance reference capability has no `minSide`
and accepts unknown dimensions at `checkSource`; an executable server test pins
that fact. No model capability, classification or admission policy was changed.

Bundle verification: run `node --test tests/templateBundleRound4.test.mjs` for
map freshness, budget, static import graphs and detail parity. After an authorized
`npm run build`, run `node scripts/check-template-bundle.mjs`. The latter rejects
any client chunk containing `sourcePromptIndex`, and template-bearing client
chunks above 1,000,000 bytes. Missing build output fails. An old build cannot
certify the new source; a denied build must be reported as unverified.

## Itemised pre-existing assertion amendments (F1)

Owner approval was given in this session for the binding/routing changes and
explicitly for the host's English baseline, Create regex, bound-detail model
names/links/prices and obsolete crop hint. This inventory consolidates A2-1,
A2-2 and A2-3 (including intermediate expectations later superseded). Base means
`aba3757e9`. No original source-prompt hash fixture changed.

| Test/fixture | Old → new assertion/setup | Reason and retained guarantee |
| --- | --- | --- |
| `tests/fixtures/data-copy-english-main.json`, recipe | `9ac28bd97a23728a6c6c7841198cd4406f3b6b46cd15180ed070474c6d5aef2f` → `4f04cb4f11f50b6367767e5676d29058431ab889b970fee7499978d1fbf22497` | Host-approved `community-parking-lot-recast` render difference: existing source-video blocked note added, Generate removed, secondary actions disabled. Source text unchanged. |
| Same fixture, detail | `e8cafa3eac3dc026b4547fbfca5b4fe44e09a67c3cbcc6e38d41f779be3ac333` → `8929e30a837a902b10c1bd4bfd3c5e30a6fd3ff1d8ae860f4d9debac67f854cf` | The same blocked recipe controls embedded in detail; no blanket baseline regeneration. Render-diff proof is recorded in `.gstack/a2-round4/parking-render-proof.json` and before/after HTML. |
| `tests/createOnboarding.test.mjs:61` | Exact regex `modelIdForName(preset.model)` → `templateModelId(preset)` in the requested-model expression | Host-approved effective route. Explicit URL model remains authoritative; cheapest bare Create and arrival assertions unchanged. Resolves the intentionally unedited A2-3 failure. |
| `tests/helpers/publicSiteRender.mjs` | No JSON module branch → `{ __esModule: true, default: JSON.parse(...) }` | Preserve the pre-existing host/harness edit; render the JSON-backed routing graph without changing assertions. |
| `tests/helpers/replacementPayloadHarness.mjs` | Legacy label/OFFLINE `MODELS` → effective route plus verified capabilities and live catalog fixture | Exercise actual bound transport, media slots and quotes. Network still forbidden. |
| `tests/replacementTemplatesPayload.test.mjs`, G1 model | Kling for all photo examples → Seedance reference only when the reviewed contract is bound | A2-1 examples were `on-the-wave`, `window-explode`, `community-pet-affection-reveal`; A2-3 returns `on-the-wave` to unsupported/Kling. Others retain their old route. |
| Same, G1 quote/ceiling | 64 → catalog reference unit × 2 (170) for bound 10s examples | Owner accepted route pricing. Fixed duration and exact ceiling remain asserted. |
| Same, G1 no-photo diagnostic | `start_image_url` scalar → ordered singleton `image_urls` for bound examples | Diagnostic still checks unchanged source bytes; actual no-photo Generate refusal/no request remains. |
| Same, G1 request prompt | Raw source equality/hash → bound text and boundHash, with independent original source hash and token-map reconstruction | Only recognized image tokens may differ. All non-bound source bytes remain exact. |
| Same, G1 exact provider body | `{prompt, start_image_url, duration:'10', generate_audio:false}` → `{bound prompt, image_urls, duration:'10', aspect_ratio, resolution:'720p', generate_audio:true}` for bound examples | Strict equality retained for the new provider transport, with template_id and server admission checks. Consent, source ownership and missing-photo checks retained. |
| Same, R4 | Output raw-source hash → boundHash only when bound; raw source stays hash-locked | No appended identity sentence; wrong template reference count additionally rejected. Generic model source ceiling rejection retained. |
| `tests/popularTemplates.test.mjs` | Different-model fixture from legacy label inequality → `templateStartId(...) === null` | A legacy mismatch may be the legitimate new route. Status 200/no-attribution assertion unchanged. |
| `tests/presetsRoute.test.mjs`, allowlist | No route fields → adds `slotCount`, `boundModelId` | Public routing metadata only. Private/platform exclusions and exact source text checks retained. |
| Same, sourceAspect | 693 → 692 framed templates | `curtain-reveal` now uses identity references, so its inferred Kling start-frame crop hint is obsolete. |
| Same, route counts | Fast/5s 131 → 120 (A2-1) → 99 (A2-2) → 100 (A2-3); reference/5s absent/0 → 11 → 32 → 31; reference/10s remains 69 | Single-slot then all-slot routing, followed by reviewed conservative grammar reclassification. Other population/source assertions unchanged. |
| `tests/runnableTemplates.test.mjs` | Sample/offered IDs and each returned model from legacy labels → effective route | Catalog eligibility, ordering and empty-catalog behavior remain asserted. |
| `tests/sourceTemplates.test.mjs`, gallery | Attribution model from legacy label → effective model | Every published template still reaches its own attributed route. |
| Same, 10s pricing | Legacy credits × 2 → effective-route credits × 2; injected 41-credit row keyed by effective model | Exact injected quote remains 82 and 10s handoff remains fixed. |
| `tests/templateModelFit.test.mjs`, mobile | Handoff model equals legacy label → effective route | Exact prompt, path, duration and tmodel checks unchanged. |
| Same, R1 prices | Kling 64 for all old Kling labels → effective 10s quote (170 for bound reference) | Source preset credits remain historical; inactive catalog still marks unavailable. |
| `tests/generationPromptLimits.test.mjs` | Handoff fixture model `modelIdForName(p.model)` → `templateModelId(p)` | Exact prompt equality and length limits unchanged. |
| `tests/presetWall.test.mjs`, links | Legacy model URL → effective model URL | Template id and Create destination retained. |
| Same, prices | Live-price fixture keyed by legacy id → effective id; missing/invalid catalog fallback legacy price → effective snapshot (19 → 85 in fixture) | Injected live-price precedence and duration multiplier unchanged. |
| `tests/templateGenerate.test.mjs` | Fixture model from legacy label → `templateModelId(preset)` | All existing request/state assertions unchanged; exercise actual route. |
| `tests/templateFraming.test.mjs` | Fallback-hint fixture selected by legacy Kling label → effective Kling route | Existing hint/preview/public parity checks retained for actual start-frame models. |
| Same, curtain-reveal | Implicit old derived crop hint → explicit reference model, null derived hint, absent web detail hint, null public-list hint | Approved obsolete start-frame guidance removal, separately pinned. |

A2-1 also updated the prior-work (untracked at base) fidelity totals test to the
then-reviewed 232/171/355/13. A2-3 updated those new tests to 232/162/355/22,
changed the picker text check from banning any “one person” excerpt to banning
the actual generic guidance sentence, enabled the multi-reference capability in
its bound-picker fixture, and strengthened rate-gate ordering expectations.
These are new A2 tests, not edits to base assertions. `templateRoutingRound3`
retains the host's `git ls-files` traversal. A2-4 changes no base assertion or data fixture; its one base harness edit adds
`.ts`/`.tsx` to `tests/helpers/publicSiteRender.mjs` relative-module resolution
(previously `.js`/`.jsx`/`.mjs` only), required for the split mobile API-source
helper. No expected result changes.
its synthetic A2 fixtures now carry per-template UI data instead of relying on
mutations of a globally bundled JSON module. New F3 tests require hints for
already ordered tokens as well as renumbered ones.

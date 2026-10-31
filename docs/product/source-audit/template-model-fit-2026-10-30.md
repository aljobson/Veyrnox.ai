# Template model fit — 2026-10-30

The 202 formerly Seedance 2.0 Fast public recipes are classified by their actual input requirements:

| Rule | Count | Generation route |
| --- | ---: | --- |
| R1, required picture | 75 | Kling 3.0 I2V, 10 seconds, 32-credit base / 64-credit quote |
| R2, optional picture | 5 | Seedance 2.0 Fast, 5 seconds, 19 credits; no upload dependencies |
| R3, copy-only | 44 | Seedance 2.0 Fast, 5 seconds; exact text and copy-only behavior retained |
| R4, text-only source | 78 | Seedance 2.0 Fast, 5 seconds, 19 credits; no picture requested |

The full API list remains 392 recipes: 265 Kling / 127 Seedance. Generated sources with no image references receive no picture guidance and use text-only five-second adaptations. Copy-only records retain their unsupported-source warning. Exact community prompt records, provenance and preview assets are unchanged. The metadata overlay quotes the assigned model's existing base price; `presetCredits` remains responsible for duration pricing.

The five R2 recipes are epic-train-doorway-scene, the-push, dreamworks-castle, a-moment-between-strangers and the-last-stagecoach. R2 and R4 adapted prompts and steps have no supplied-media dependency. Red-thread-story and meal-together request one starting image containing both characters; fashion-catch requests one image showing the model wearing the garment or accessory. The changed guidance is translated in all 11 locale catalogs. Existing uploaded/supplied-image intros are retained without a duplicate introduction.

`TemplateRecipe` honours `preferAdaptedPrompt`, including when the exact source prompt could run independently. Exact text stays available for viewing and copying; generation uses the designated adaptation. The phone parser and handoff already use that adaptation. Phone code is unchanged. A narrowly scoped `runnableModel` exception in `scripts/lib/data-i18n-exceptions.mjs` identifies the fixed Kling provider name without exempting other prose.

The host verified `tests/fixtures/catalogTemplateModels.json` against live `/api/catalog` on 2026-10-30: Seedance Fast is 19 credits, [5] seconds, no media; Kling I2V is 32 credits, [5, 10] seconds, required image and optional endImage. The browser fallback maps Seedance Fast to the existing Crun text-only capability; the OpenRouter gateway contract remains unchanged.

`node scripts/import-seedance-source-templates.mjs --data-only` rebuilds metadata and 122 generated recipes from the immutable committed audit without downloading or encoding media. `--check` compares both generated files byte-for-byte. The regular import uses the same rules.

Verification covers model contracts, all 392 serialized API recipes, rule counts, provenance, prices, text-only dependencies, single-image guidance, generator consistency, web/phone handoff, translations and knowledge sync. Full `npm test` passes (5,938 tests). Inside a sandbox that denies local sockets, six local-server tests fail with `listen EPERM`; that comes from the environment, not from this change.

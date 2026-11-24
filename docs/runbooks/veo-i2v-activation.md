# Veo single-image activation

No Veo image flag may be turned on until the Crun route breaker fix is merged and applied, and its PR and migration numbers are recorded here.

Breaker fix PR number: **[REQUIRED — blank]**. Breaker fix migration number(s): **[REQUIRED — blank]**.

All three image-input flags stay off until independently proved. Do not infer i2v proof from a t2v task or from another variant. This build adds no parity migration and performs no paid generation.

1. With owner authorization, run one billed proof **through `packages/adapters/crun.js`** for each variant being enabled, using the same owned-upload or Library resolution path and real 15-minute signed R2 source URL as generation admission. Use the existing t2v route endpoint, one `image_url`, a prompt, 16:9 or 9:16, and the existing five-second billing-unit input (output is pinned to eight seconds). Do not substitute a public sample URL. A probe must refuse placeholders, cap its estimate and require `--yes`, following the existing probe convention. Never retain the source signature in logs or parity text.
2. Record task id, actual charge (expected 15 / 30 / 225 credits for Lite / Fast / 3.1), duration, output host and frames inspected. Confirm 720p and eight-second output; verify the signed image was actually used. An estimate alone is not a billed proof. About $0.07 / $0.15 / $1.09 respectively; verify the owner's current rate before spending.
3. Verify that the billed i2v output host is in the Crun allowlist in `packages/adapters/r2Copy.js`, and require the output to complete the real copy-to-R2 path. Record evidence of the stored R2 output; a provider URL alone is not a completed proof. If the host is new, add that exact host in a reviewed change and repeat the copy proof before enabling the flag.
4. Only after success, write a record-only migration for that variant, identifying the exact catalog id, supplier and unchanged t2v endpoint. Append the evidence and exact marker below to its existing parity record. Assert exact ROW_COUNT = 1; make repeat application idempotent without appending twice. Do not change route state, order, price or cost. The owner approves applying this migration.
5. Enable only that variant's key in the existing `APP_RUNTIME_FLAGS` JSON. Preserve all other keys. Confirm source-slot discovery and pre-debit admission with a healthy route, NULL stored breaker, open provider admission and the proved parity marker. Roll back by setting only that key to false.

| Variant | Key | Required parity marker |
| --- | --- | --- |
| Lite | veoI2vLite | `[veo-i2v:google/veo3-1-lite-i2v:signed-source:v1]` |
| Fast | veoI2vFast | `[veo-i2v:google/veo3-1-fast-i2v:signed-source:v1]` |
| 3.1 | veoI2v31 | `[veo-i2v:google/veo3-1-i2v:signed-source:v1]` |

No image fallback. No two-image, four-second, 1080p or auto-aspect contract. Face quality, crop/letterbox behavior and signed-URL fetch compatibility remain unproved until observed. Existing offer gating remains in force; enabling an image flag does not remove an offer's gate. Video retention uses the existing copy-to-R2 path.

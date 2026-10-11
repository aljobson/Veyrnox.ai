# Camera-generation controls — 11 October 2026

Status: production release and actual live controls verified. PR #890 (squash `e90bab763ee6b4b8c206f92dac36ac293abb3e7c`) deployed successfully in run 38151336301 at 15:31:42 UTC. Worker `392d36da-a0b0-4e6e-9966-f5a8a2ba15c1` served 100%; live FAL/KIE direction, pace, quote and missing-source/full-prompt preflight passed without a paid job.

## Contract and scope

The normal Generate panel offers AI camera movement: push/pull, pan, orbit, tilt or locked camera, with gentle/steady/fast pace and an editable scene description. It shows the exact complete composed prompt before submission. Only supported live prompt-driven image-to-video models with required image sources and existing image/endImage roles are selectable. No provider endpoint, price, schema, source permission or credit mutation is introduced.

Existing FAL `kling-3.0-i2v` and KIE `kling-3.0-i2v-kie` records qualified this surface. Sources remain actor-owned MIME-inspected Library assets with the existing consent statement and gateway inspection before debit. The normal submission signature includes the composed prompt; changing direction changes that signature. Accepted jobs retain polling, private Library recovery and editor insertion. Account changes clear private inputs, consent and job state.

## Checks and running-app evidence

Ten focused generation tests passed. The new checks use the registered FAL/KIE capability records, reject incompatible/gated rows and validate prompt boundaries, original source roles/consent, duration, quote and signature semantics. Product files passed ESLint.

A temporary local-only Reticle integration and public live-catalog read proxy were used in the running actual editor. They were removed before commit; no production CSP or auth path was widened. Explicit `verified: yes` consequences established:

- Selecting movement yielded exactly the two inspected live image-to-video model IDs.
- Selecting right orbit and fast pace changed those controls; choosing KIE and ten seconds displayed the existing 56-credit quote.
- Complete direction retained the subject text, right orbit, fast pace, supplied-image/scene-preservation and continuous-shot instructions; the observed action made zero generation POSTs.
- A 2,000-character scene was refused because the composed prompt exceeded the model's 2,000-character bound. Correcting it restored the valid complete direction.

Reticle reported clean integrity/zero console errors for these verdicts, with partial coverage for three unrelated virtualized unmounted rows. A preliminary ambiguous selector/setup failed; it remains a failed attempt. Explicit combobox names corrected the setup and the final consequences passed. No unknown/no-fault verdict is counted as success.

## Practical limits

Camera direction is provider prompt guidance. No paid generation was submitted to qualify output trajectory, model quality or billed cost; none of those is claimed. This is not full CapCut parity. Provider/licensing, native translation, lyrics/vocal isolation, semantic/depth relight/reshape, Ads and broader footage/device quality remain in the feature inventory.

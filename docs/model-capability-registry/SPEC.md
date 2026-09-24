# Model capability registry — spec

- **Status**: Draft for owner review (2026-09-22)
- **Related**: `lib/modelCapabilities.js` ([ADR-0027](../adr/0027-model-capability-registry.md); replaced `lib/providerDuration.js`), `app/api/v1/generations/route.js`,
  `app/api/catalog/route.js`, `app/veyrnox/app/create/page.js`,
  [ADR-0020](../adr/0020-kie-and-openrouter-providers.md)
- **Source of the design**: `packages/studio/src/modelCapabilities.js`,
  `videoModelParameters.js`, `imageSizing.js` and the `inputs` schema of
  `models.js` in Anil-matcha/Open-Generative-AI (MIT, © 2026 Open Generative AI
  Contributors). We port the helper logic and the schema shape, not the
  31k-line MuAPI catalog.

## 1. Problem

What a model accepts, and what one priced unit buys, is spread over five places:

| Knowledge | Where it lives today |
|---|---|
| Which input keys exist at all | `ALLOWED_INPUTS` in the generations route (one global list for every model) |
| Which clip lengths a model sells | `DURATION_FIELDS` prefix match in `lib/providerDuration.js` |
| Field renames and pinned values | `PAYLOAD_SHAPES` in the same file (5 endpoints) |
| Per-model aspect ratios | `PAYLOAD_SHAPES[...].aspects` (Veo only), kie/OpenRouter adapters |
| What the UI may offer | `durationsFor()` feeding `/api/catalog`; every other control is hard-coded in the create page |

Adding a model means touching three to five of these, and forgetting one is
silent. Checked against fal's live schema on 2026-09-22, the active
`kling-3.0-i2v` row already has both failure modes: the gateway forwards
`image_url` but the endpoint requires `start_image_url` (every submit would be
rejected and refunded; it has had no jobs), and fal defaults `generate_audio`
to on, which bills $0.168/s against the row's $0.112/s cost. The Veo 8-second bill (#153) was exactly that: fal's default duration
was not pinned, so the request bought more than the catalog priced. The create
page also offers aspect ratios a model cannot make, which debits and then
refunds.

## 2. Goal

One capability record per provider endpoint, read by four consumers:

1. **`/api/catalog`** publishes a client-safe view (no `provider_endpoint`,
   no costs) so the create page renders exactly the controls a model supports.
2. **The gateway** validates inputs against the model's own schema before the
   debit, replacing the global allowlist check for that model.
3. **Payload shaping** renames fields and pins billed quantities from the same
   record, replacing `PAYLOAD_SHAPES` and `DURATION_FIELDS`.
4. **Pricing** reads the unit from the record (per output, or per N-second
   unit with an allowed length list), so price and request can't drift apart.

Price stays in `model_catalog.credits_5s` (CLAUDE.md: the catalog is normative
for pricing). The registry says *what a unit is*; the catalog says *what it
costs*.

## 3. Record shape

Code, not database: `lib/modelCapabilities/registry.js`, keyed by
`provider_endpoint`. A registry change is a reviewed PR with tests; a catalog
row can only go `active` if its endpoint has a record (see §6).

```js
'fal-ai/veo3.1/fast': {
  provider: 'fal',
  kind: 'video',                       // image | video | audio | speech
  unit: { type: 'clip', seconds: [4] }, // what one priced unit buys
  inputs: {
    prompt:          { type: 'string', max: 2000, required: true },
    negative_prompt: { type: 'string', max: 2000 },
    aspect_ratio:    { type: 'enum', values: ['16:9', '9:16'], default: '16:9' },
    seed:            { type: 'int', min: 0, max: 2147483647 },
  },
  media: {},                           // no reference inputs on this endpoint
  fixed: { duration: '4s', resolution: '720p', generate_audio: true },
  rename: {},                          // our field -> provider field
  lengthField: null,                   // provider field our duration maps to
},

'fal-ai/kling-video/v3/pro/image-to-video': {
  provider: 'fal', kind: 'video',
  unit: { type: 'clip', seconds: [5, 10] },
  inputs: {
    prompt:       { type: 'string', max: 2000 },
    aspect_ratio: { type: 'inherited' },            // follows the start image
  },
  // fal schema 2026-09-22: start_image_url is required; generate_audio
  // defaults to true ($0.168/s) — the row is costed at audio off ($0.112/s).
  media: { image: { field: 'start_image_url', min: 1, max: 1 },
           endImage: { field: 'end_image_url', max: 1 } },
  fixed: { generate_audio: false },
  rename: {},
  lengthField: { field: 'duration', map: { 5: '5', 10: '10' } },
},

'fal-ai/ace-step-1.5': {
  provider: 'fal', kind: 'audio',
  unit: { type: 'output' },
  inputs: { prompt: { type: 'string', max: 2000, required: true },
            seed:   { type: 'int', min: 0, max: 2147483647 } },
  media: {},
  fixed: { duration: 60, thinking: true, num_outputs: 1 },
  rename: {}, lengthField: null,
},
```

Rules carried over from upstream (`modelCapabilities.js`,
`videoModelParameters.js`):

- `media.<kind>` gives the provider field, and whether it takes one URL or a
  list (`max > 1` means an array field). Reference counts are enforced before
  the debit.
- `aspect_ratio: { type: 'inherited' }` means the UI hides the picker and the
  gateway rejects the key.
- Enum options come from `values`; integer ranges from `min/max/step`.
- `fixed` always wins over user input and is where every billed quantity is
  pinned (length, resolution, count, audio on/off).
- Kept from upstream but not needed yet: `rules` (narrow one option by
  another, e.g. 1080p ⇒ 5s only), for when a model's price tier depends on it.

Dropped from upstream on purpose: any `cost` field (price lives in the
catalog), MuAPI ids and field names, and per-resolution endpoint splitting (we
sell one priced tier per row).

## 4. Consumers

### Gateway (`app/api/v1/generations/route.js`)

- Keep `ALLOWED_INPUTS` as the outer gate (shape and size of every value).
- Add a per-model check: a key must be in the model's `inputs`, `media` or be
  `duration_seconds` with a value in `unit.seconds`. Anything else is refused
  with the same `inputs_key_not_allowed:*` / `inputs_invalid:*` codes, before
  `ledger_debit`.
- Media URLs still go through `resolveSource` (our R2 uploads only).
- `priceFor` becomes `credits_5s × units`, where units is 1 for `output`, or
  `seconds / seconds[0]` for `clip` (must divide exactly; otherwise refuse).

### Payload (`lib/providerDuration.js` → `lib/modelCapabilities/shape.js`)

`shapeForProvider` keeps only declared keys, applies `rename`, maps
`duration_seconds` through `lengthField`, puts media URLs in their fields,
then spreads `fixed` last. kie and OpenRouter adapters read the same record
instead of their own tables.

### Catalog API (`/api/catalog`)

Each model gains `capabilities: { kind, lengths, inputs, media }` with
`fixed`, `rename`, field names and anything provider-specific stripped.
`durations` stays for one release for old clients.

### Create page

Controls render from `capabilities` (aspect ratio picker only when `enum`;
length picker from `lengths`; reference-image slots from `media`). Port the
option-derivation helpers from upstream `videoModelParameters.js`, not its
components.

## 5. Rollout

1. **Registry + tests, no behaviour change.** Records for all active endpoints,
   generated from today's `PAYLOAD_SHAPES`/`DURATION_FIELDS` plus the live fal
   OpenAPI schema for each endpoint. A test asserts `shapeForProvider` output
   is byte-identical to today's for a fixture per endpoint.
2. **Gateway reads the registry.** Swap the per-model check and `priceFor`.
   Delete `PAYLOAD_SHAPES`, `DURATION_FIELDS`, `payloadCheck`.
3. **Catalog API publishes `capabilities`.**
4. **Create page renders from it.** This is where reference images, start/end
   frames and per-model aspect ratios reach users.

Each step ships on its own; step 1 and 2 are money-spine changes and need an
ADR update per CLAUDE.md.

## 6. Guardrails

- **CI:** every endpoint in `model_catalog` migrations with `active = true`
  must have a registry record; every record's `fixed` must pin a length for
  `kind: 'video'` (the Veo lesson).
- **Watcher:** extend `scripts/check-fal-catalog.mjs` to diff each record's
  `inputs` and defaults against the live fal OpenAPI schema, and fail when fal
  changes a default that affects price (duration, resolution, num outputs).
- **Attribution:** the ported helpers keep an MIT notice header crediting Open
  Generative AI Contributors.

## 7. Out of scope

Multi-step pipelines (workflows, agents, design agent): they need a
pre-authorised hold and per-node debits, which is a separate ADR.

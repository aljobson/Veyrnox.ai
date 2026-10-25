# ADR-0261: Server render for editor export (Concat runner)

Status: Proposed
Date: 2026-10-25

## Context

The browser editor renders and exports on the user's device (ADR-0080, ADR-0097,
ADR-0247 D5), which is why editing and export are free. That limits export to
what a browser can do: 720p or 1080p, ten minutes, and whatever the device
survives. Phones are the weak case (ADR-0247 slice 3: a 25 MiB cap and a
device test gate).

PR #1652 measured [Concat](https://github.com/jub0t/concat) (AGPL-3.0-or-later)
as a headless render service. `concat-cli serve` exposes a token-guarded
JSON-RPC API; a pinned upstream build with Mesa lavapipe renders with no GPU.
Measured on a Fly performance-4x machine (4 CPU, 8 GB, amd64), 5 s 720p clip:
640x360 in 3.1 s (0.61x realtime), 1080p in 12.1 s (2.42x). A proof of concept
(`services/concat-render/poc/translate.mjs`) turned a schemaVersion 2 editor
timeline into Concat calls and rendered trim, clip order, text, a 0.5 s dissolve,
per-clip volume and a separate audio clip correctly. Not covered: pixel
comparison with `editorRender.mjs`, schemaVersion 3, other transitions.

## Decision

Add an opt-in **Export on server** path for editor projects, rendered by Concat
running unmodified in its own container on Fly Machines. Browser export stays the
default and stays free. Nothing changes for a user who does not choose it.

1. **Runner.** One Docker image, built from a pinned upstream commit, one render
   per Machine (Concat refuses a second export with `busy`). It follows the
   OpenMontage runner pattern (ADR-0074): the Worker never runs ffmpeg, Concat
   is reached only over Fly's private network with a token held as a Fly secret
   and a Worker secret, and the runner holds no Supabase key and no R2 write
   key.
2. **Job.** A new `jobs` kind. The Worker validates the project document, asks
   for fresh presigned GET links (at most 15 minutes) for every source, and
   mints one presigned PUT for a random-UUID key scoped to the job. The runner
   downloads sources to a scratch disk, translates the document, renders,
   uploads, and reports through a signed callback (HMAC-SHA256 over timestamp
   and raw body, 300 s tolerance, `webhook_events(source, external_id)`).
3. **Result.** The file becomes an editor-render in the Library through the
   existing `editor-renders` inspect route, not a second storage path.
4. **Money.** One `model_catalog` row prices server render (credits per output
   second, by resolution). Debit once at start through `ledger_debit` with the
   job's idempotency key; `ledger_refund` on runner failure, cancel or timeout.
   A liveness sweep refunds a lost run, as in ADR-0074's amendment. The app
   computes no price.
5. **Flag.** `EDITOR_SERVER_RENDER_ENABLED`, `"false"` in `wrangler.jsonc`. The
   export dialog shows nothing while it is off. Staging first.
6. **Limits.** A queue depth limit returns `{error: "render_busy"}`. Input
   documents are bounded by the existing project schema (16 tracks, 40 clips,
   ten minutes). Sources are only the user's own Library media and uploads; the
   runner fetches no other URL.

## Not yet decided (blocks any user-facing release)

1. **AGPL.** Concat is AGPL-3.0-or-later. The plan is to run it unmodified, as a
   separate process behind an API, and to publish the Dockerfile and pinned
   commit (this repository is public). Any change to Concat, or a decision to
   link it into our code, needs the owner's legal read first. Until then the
   flag must stay off in production.
2. **Price.** The measured cost is about 2.4 CPU-seconds per output second at
   1080p on four CPUs. The credit price, and whether a free allowance applies,
   are the owner's call. A larger machine or a GPU host may change the number.
3. **Fidelity.** The server render and the browser preview are drawn by
   different engines. Text, fonts and other transitions may differ. The
   dialog must say so, or a pixel-comparison gate must pass before release.

## Slices

1. Runner repo or folder, image, fake-source smoke test (done in #1652).
2. Translator as a tested module for schemaVersion 2 and 3, with fixtures.
3. `jobs` kind, callback, refund path, idempotency tests, behind the flag.
4. Export dialog option and mobile entry, behind the same flag.
5. Measured price, fidelity decision, owner flip.

## Consequences

- A second render engine to keep in step with the browser one. Every new editor
  feature needs a translator rule or an explicit "not supported on server".
- A new always-cold, pay-per-run service. Idle cost is near zero when Machines
  stop; a render costs roughly a cent for a short 1080p clip (estimate, to be
  measured on a real bill).
- Long and high-quality exports stop depending on the user's device.

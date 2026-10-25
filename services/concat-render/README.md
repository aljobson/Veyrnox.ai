# concat-render

Headless [Concat](https://github.com/jub0t/concat) (AGPL-3.0) as a render
service. Unmodified upstream, pinned by commit in the Dockerfile, reached only
over its token-guarded JSON-RPC socket. Admission and recovery use independent
`EDITOR_SERVER_RENDER_ENABLED` / `EDITOR_SERVER_RENDER_RECOVERY_ENABLED` switches,
configured as `"serverRender":"false"` / `"serverRenderRecovery":"false"` in
`EDITOR_RUNTIME_FLAGS`. Status, cancel and callbacks remain available when off.
Apply 0395/0396 before activation; the reaper supports a Worker-first rollout for
one release. On rollback disable admission and leave recovery enabled to drain
existing jobs. There is no UI or deployment
in this slice. The catalog entry is inactive with no resolution rates set.

Questions this answers: does Concat render with no GPU (lavapipe), how fast,
and does its `concat.json` suit our timeline.

## HTTP runner

Build from the checkout root with
`docker build -f services/concat-render/Dockerfile -t concat-render .`.
The default entry point is the HTTP wrapper on port 8080. It accepts signed
`/run`, `/cancel`, and `/runs` requests and runs one render at a time.

The runner needs `EDITOR_RENDER_SIGNING_SECRET`, `EDITOR_RENDER_CALLBACK_URL`
(the fixed Worker `/api/webhook/editor-render` URL), and
`EDITOR_RENDER_SOURCE_HOSTS` (comma-separated exact private R2 endpoint hosts).
The Worker needs the same signing secret and `EDITOR_RENDER_RUNNER_BASE` set
by the operator; it constructs callbacks from `PUBLIC_HOST`. Secrets belong
in the platform's secret store, never command lines or checked-in files.
No R2 write credential or Supabase credential is passed to the runner.

The wrapper creates a new local Concat token per render, discards Concat's
stdout/stderr, and kills the process and wipes its directory at completion.
It downloads owned sources immediately, renders, checks the 25 MiB cap, asks
for a fresh strict PUT grant, uploads with the returned headers, and signs its
completion callback. Network-failed PUTs retry up to three times with fresh
file streams; a 412 also sends completion so the Worker can verify the existing
bytes. Worker inspection computes the authoritative SHA256.

The original smoke driver is retained at `/app/services/concat-render/smoke.mjs`.
For an isolated spike, override the image command to start `concat-cli serve`
and provide a temporary `CONCAT_API_TOKEN` through the environment. Such a
manual invocation bypasses the wrapper's log suppression; keep its stdout
private. The production entry point must remain the wrapper.

Prints `realtimeFactor` (render seconds per clip second). The Fly numbers are
the ones that count; local Docker on Apple silicon runs arm64.

## poc/

`translate.mjs` turns a schemaVersion 2 editor timeline into Concat API calls
(`project.create`, `media.import`, `edit.apply` addClip/trimClip/moveClips/
updateClip/addTextClip, `export.run`). `run.mjs` builds two test clips, renders
a sample timeline and prints the time. Copy into a running container
(`docker cp services/concat-render/poc cr:/tmp/poc`) and run
`CONCAT_API_TOKEN=... node run.mjs` there.

Checked on a 3-clip sample (7 s, 1080p) on 2026-10-25: trim, clip order, text
timing/position/font (DejaVu Sans bold, non-italic), a 0.5 s dissolve starting at
the cut (matches our timing), per-clip volume (a 0.5 clip measured 6 dB down) and
a separate audio clip (ends on time; its 0.3 gain adds only about 0.3 dB over
the clip audio in this sample, so the mix is consistent but weakly tested).
Not covered: pixel comparison with `editorRender.mjs`, dissolve when the
previous clip has no spare source, schemaVersion 3, other transitions.

## Fly measurement (2026-10-25)

Machine: performance-4x, 8 GB, ams, CPU only (lavapipe). 5 s 720p clip with audio.

| Export | Render time | Realtime factor |
| --- | --- | --- |
| 640x360 | 3.06 s | 0.61x |
| 1920x1080 | 12.1 s | 2.42x |

So a 30 s 1080p export is about 70 s of render; short vertical clips are fine.
The original spike exposed its temporary token in Concat stdout. The HTTP
wrapper suppresses that output; it never logs a Concat token.

## Acceptance

`npm test` runs pure translator fixtures, API/callback/refund checks, runner
admission checks and sweep isolation. To run the SQL race/preservation suite,
create an **empty disposable local Postgres database named with `test`** and
set `EDITOR_RENDER_TEST_DATABASE_URL` when running
`node --test tests/editorServerRenderDatabase.test.mjs`. The suite refuses a
nonlocal address or an existing `jobs` table; it leaves fixtures in that test
database for inspection. It loads the real ledger, settlement and escalation
functions with minimal unrelated platform fixtures. A full Supabase migration
replay and a real Concat render remain release checks, as do price and AGPL.

Exact host database proof (local PostgreSQL 15+, test superuser, fresh database):

```sh
createdb --host=127.0.0.1 --port=5432 --username=postgres editor_server_render_round2_test
EDITOR_RENDER_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:5432/editor_server_render_round2_test' node --test tests/editorServerRenderDatabase.test.mjs
```

# Video Enhance asset delivery validation

Updated 2026-09-28. **Static asset delivery and disabled-editor checks pass**
in both local production-mode Worker testing and an existing deployed version
preview. This does not qualify or activate the enabled production editor.

## Deployed version result

- Version: `76e1a586-3fe2-462f-aad5-5dfcbd437af6` (number 1175).
- Branch alias recorded by Cloudflare: `codex-video-enhance-validation`.
- Created: 2026-09-28T13:11:01.774875Z.
- Runtime metadata: compatibility date `2026-09-01`, flag `nodejs_compat`.
- Script ETag: `a3562e5287ba33de2250af52a1854f0729b52c1fd5f1209dacd2b7ff1ddff107`.
- [Version preview](https://76e1a586-veyrnox-ai.al-jobson.workers.dev/app/enhance).

Cloudflare version metadata identifies this branch but does not provide its Git
commit in the returned annotations. The served inventory and all asset hashes
match the repository's pinned manifest. This is a result for the exact version
above, not a guarantee about a later branch-alias target.

The read-only checker passed against the version URL:

```sh
node scripts/check-video-enhance-delivery.mjs https://76e1a586-veyrnox-ai.al-jobson.workers.dev
```

Verified the model, six JS/WASM runtime files and three notices: exact bytes and
SHA-256, expected MIME types, immutable one-year browser caching, ETags and
`nosniff`. The manifest matches exactly. A nonexistent runtime file returns 404
without immutable caching. Editor HTML is private/non-immutable, has nonce CSP
without WASM or JavaScript evaluation exceptions, and says “Preview unavailable”.

No media, credentials or authenticated sessions were sent by this check. No new
version was uploaded, deployed to production, or enabled. The existing build
preview was retrieved through read-only version inventory calls.

## Remaining release gates

Model license/terms review, acceptance of ADR-0065's CSP decision, full-document
navigation boundaries, enabled-editor production tests, severe occlusion and
varied-subject quality, total-memory/device qualification remain open. Successful
static delivery does not demonstrate inference, export or media privacy under
the proposed enabled production policy.

## Local checks and implementation history

## Production-mode asset delivery check

`public/_headers` sets immutable one-year browser caching only for the pinned
`/video-enhance/mediapipe-1.0.1-face-landmarker-1/` inventory. Keep this rule in
sync when bumping the asset version. HTML and the production CSP are unchanged.
Cloudflare applies these rules to static-asset responses; see its
[static headers documentation](https://developers.cloudflare.com/workers/static-assets/headers/).

After `npm run build:worker`, run a local Worker preview on port 3187, then:

```sh
node scripts/check-video-enhance-delivery.mjs http://127.0.0.1:3187
```

The check requests the actual asset bytes and verifies hashes, MIME types,
immutable cache headers, ETags and nosniff for the complete inventory. It also
checks the manifest, a missing asset, private editor HTML, nonce CSP without
evaluation exceptions, and the disabled production editor. No credentials or
media are sent. This does not exercise the enabled production editor.

Local verification on 2026-09-28 passed all ten files and manifest checks,
missing-file handling, private HTML, nonce CSP and disabled editor. The first
run found the model MIME type absent; the exact model path now explicitly serves
`application/octet-stream`. Full Worker build, final asset repackaging and the
test suite (836 passed, one skipped) passed.

Initial qualification limit: bundled workerd supports dates only through 2026-08-08,
while the project requests 2026-09-01. The exact-date preview failed to start.
The successful **local-only** check used `wrangler dev --local
--compatibility-date 2026-08-08 --ip 127.0.0.1 --port 3187`; no project date was
changed and nothing was deployed. The exact-date and deployed follow-ups recorded in this report subsequently
resolved these static-delivery verification gaps.

Exact-date follow-up (2026-09-28, artifact from `1aa1c1a`): Wrangler **4.142.0**
from an isolated npm execution cache successfully ran the unchanged project
configuration at **2026-09-01**, with no compatibility-date override. All HTTP
delivery checks passed again. Reproduce with:

```sh
WRANGLER_SEND_METRICS=false npm exec --yes --package=wrangler@4.142.0 -- wrangler dev --local --ip 127.0.0.1 --port 3187
node scripts/check-video-enhance-delivery.mjs http://127.0.0.1:3187
```

The earlier local date limitation is resolved by this tool version; the project
lockfile remains unchanged. Enabled-editor production acceptance remains
open. No CSP, activation or production deployment changed.

# ADR-0260: Render audited LipSync reference media from its CDN

## Status

Accepted — 2026-10-25

## Context

Each creative-tool page identifies the exact public example displayed by its
corresponding LipSync.video page. The first implementation streamed those fixed
URLs through a same-origin Next route. Cloudflare Workers cannot retrieve these
assets from the upstream CDN in production, so the route returned `502` even
though browsers and the audit checks could retrieve every asset.

Copying the videos into the application repository would duplicate large media
files, obscure their provenance, and make upstream corrections stale. Allowing
arbitrary remote media or a caller-provided proxy URL would unnecessarily widen
the browser and server-side security boundaries.

## Decision

Render only the 22 fixed URLs in `CREATIVE_FEATURE_EXAMPLES` from the exact
origin `https://cdn.lipsync.video`.

- Add that origin to `img-src` and `media-src` only.
- Do not add it to `script-src` or `connect-src`.
- Set `referrerPolicy="no-referrer"` on every reference image and video.
- Keep the visible source-page attribution beside each example.
- Remove the failing server-side media proxy; callers cannot supply media URLs.

## Consequences

The examples work in production and remain attributable to their published
source. The CDN receives the asset request but no Veyrnox page URL or query
string. Availability follows the source CDN, and any new host still requires a
separate review and CSP decision.

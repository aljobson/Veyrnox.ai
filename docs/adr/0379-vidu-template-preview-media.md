# ADR-0379: Render CRUN Vidu template previews from the Vidu CDN

Status: Accepted
Date: 2026-11-26

## Context

The signed-in template catalog reads CRUN's official Vidu template index on the
server. CRUN currently returns every Vidu cover and preview from the public
origin `https://scene.cf.vidu.studio`. Production's narrow content security
policy did not admit that origin, so the catalog metadata loaded while every
cover was blank and every clicked video failed.

Proxying 521 live catalog entries through the application would add an
unbounded media relay and make Veyrnox responsible for large upstream video
transfers. A wildcard media policy would create an unnecessary exfiltration
surface.

## Decision

- Admit only `https://scene.cf.vidu.studio` to `img-src` and `media-src`.
- Do not add the origin to `script-src`, `connect-src`, or `frame-src`.
- Send `referrerPolicy="no-referrer"` on CRUN provider cover and video elements.
- Keep generation disabled; this decision enables catalog previews only.
- Keep the existing server-side catalog normalization and URL validation. The
  browser never receives a CRUN API key.

## Consequences

Vidu covers and click-to-play previews render directly from their published
CDN without receiving the Veyrnox page URL. Preview availability still follows
Vidu's CDN, and any additional media origin requires a separate review and CSP
decision.

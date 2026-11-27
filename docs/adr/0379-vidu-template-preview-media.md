# ADR-0379: Render CRUN template previews from exact provider CDNs

Status: Accepted
Date: 2026-11-26

## Context

The signed-in template catalog reads CRUN's official Kling, ByteDance, and Vidu
template indexes on the server. A production audit of all 1,088 live entries
found covers and previews on eight public origins: three Kling origins,
`https://cdn.crun.ai`, and four Vidu origins. Production's narrow content
security policy admitted none of them, so catalog metadata loaded while covers
were blank and clicked previews failed.

Proxying 1,088 live catalog entries through the application would add an
unbounded media relay and make Veyrnox responsible for large upstream video
transfers. A wildcard media policy would create an unnecessary exfiltration
surface.

## Decision

- Admit only the eight origins observed across the complete live CRUN indexes
  to `img-src` and `media-src`:
  - `https://s15-kling.klingai.com`
  - `https://v15-kling.klingai.com`
  - `https://d21-kling.klingai.com`
  - `https://cdn.crun.ai`
  - `https://scene.cf.vidu.studio`
  - `https://scene.vidu.zone`
  - `https://image01.cf.vidu.studio`
  - `https://image01.vidu.zone`
- Do not add these origins to `script-src`, `connect-src`, or `frame-src`.
- Send `referrerPolicy="no-referrer"` on CRUN provider cover and video elements.
- Keep generation disabled; this decision enables catalog previews only.
- Keep the existing server-side catalog normalization and URL validation. The
  browser never receives a CRUN API key.

## Consequences

Kling, ByteDance, and Vidu covers and click-to-play previews render directly
from their published CDNs without receiving the Veyrnox page URL. Preview
availability still follows each provider's CDN, and any additional media origin
requires a separate review and CSP decision.

# ADR-0289: Phone model page, source duration card and video agent resume

Status: Accepted for implementation under the frozen create-small work order.

The phone model detail route `/model/[id]` mirrors the web model page: catalog
title, base price and unit, Generate, Credit packs, the charging note, and ordered
catalog facts. It shows only `credits` from the catalog as a price; no price is
computed or multiplied. Models rows open this page; Generate opens the existing
Create flow. The catalog is public data and the page retains nothing across mounts.

The Create source duration card mirrors the web card for video and audio models
whose required audio or video source has a finite duration limit, unless a fixed
or mapped output duration is declared. The lip-sync speech note applies only to
`latentsync`. Existing duration controls, source rights, and pricing remain intact.

Video agent resume mirrors the web's 60-minute resume window. The web uses browser
job history; the phone reads the account's server job list, newest first, seeking
a queued or running video-agent job. Each check reads at most five pages of 24 jobs
(120 rows), costing at most five reads of the shared 600-per-minute quota. Paging
ends when exhausted or beyond the window. A run behind 120 newer jobs, or older
than an hour, can be missed; the server still blocks a second active run and that
refusal triggers another check. The frozen work order chooses the 60-minute window.

Checks run on focus, foreground, account change, and an in-progress refusal. A
revision counter, account identity and mounted guard discard stale responses
after newer checks, account changes, blur, or unmount. Failed checks silently hide
the card. No job history is cached or logged. Open progress uses the existing job
screen; returning from a finished job refreshes and removes the card.

Follow-ups, in order:

1. Fixed output length card and mapped duration chip labels.
2. Premium states for gated models in Models, Create and model details.
3. Model links from Tools, Templates and search; templates on model details.
4. In-place video-agent progress.
5. Template details, skill buttons, prompt placeholders and Library thumbnails.

Clip-edit slow motion, Enhance (XL), Film 16:9 master and motion-transfer templates
remain outside the owner-approved scope.

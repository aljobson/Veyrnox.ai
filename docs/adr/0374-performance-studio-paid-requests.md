# ADR-0374: Performance studio paid requests

Status: Implemented in source; not yet exercised against a live server.
Date: 2026-11-21

## Context

A read-only audit of the web lip-sync and dubbing studio found five defects in its paid path. Each was confirmed against the repository's server validators or by a failing test:

1. Bare asset ids were read by the server as images, so lip sync was refused with `source_slot_invalid` or `source_count_exceeded` after the speech job had been charged.
2. Burned subtitles sent `whole: true`, which the clip editor refuses as `inputs_invalid:clips`.
3. Subtitles were quoted at 7 units. The server charges 8 for a 36 to 40 second clip.
4. The speech length guard counted spaces, so Chinese, Japanese and Korean scripts were underestimated and could be paid for before the render was refused.
5. Every POST created a new idempotency key, so Retry after a lost reply could charge twice.

## Decision

- Every lip-sync source names its slot.
- Subtitles send the clip's measured length from `/jobs/:id/media-info`.
- The studio shows the subtitle price as "up to" the most the selected model's length can cost. Before charging, it asks the server for the exact price with a request pinned to 0 credits, which is refused uncharged. A price above the approved one stops without a charge.
- The speech estimate counts Han, kana and Hangul by character and follows the chosen speed. The rates are ordinary speaking rates and have not been calibrated against the speech model.
- One key belongs to one exact request body until its outcome is known. A retry of an unresolved request looks the key up first:
  - a job that was found is adopted, with no new charge;
  - a confirmed refund allows a new key;
  - no job replays the same key and body, because `ledger_debit` refuses a known key with different inputs;
  - a failed lookup sends nothing.
- An uploaded file is reused for the same browser file, so a retry keeps the same body. A `source_*` refusal forgets the upload.
- The studio no longer says "was not charged" when the outcome is unknown.

## Consequences

Customers see "up to" on the subtitle price and may be charged less than that figure. No ledger, catalog or server route changes.

Open attempts live in the page's memory. Reloading the page during an unresolved request loses the key, so a later attempt could still charge again.

The engines `sync-lipsync-v3` and `sync-lipsync-1.9-long` still have no catalog row or capability record. This decision does not change them.

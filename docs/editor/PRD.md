# PRD — Clip Editor (stitch, trim, add audio)
**Status:** Draft · 2026-09-22
**Owner:** product owner (Al Jobson)
**Language:** terms are as defined in [CONTEXT.md](../../CONTEXT.md).
**Precedence:** [CLAUDE.md](../../CLAUDE.md) and [docs/adr/](../adr/README.md)
win over this document wherever they disagree.

## 1. Overview

Veyrnox.ai generates short clips: 5 to 10 seconds of video, a voice line, a
music bed. Customers who want a finished video today have to download
everything and assemble it in another tool. This adds the three edits that
turn several generations into one video, without leaving the product:

1. **Stitch** two or more of the user's video clips, in order, into one video.
2. **Trim** a clip to the part the user wants.
3. **Add audio**: lay one of the user's audio generations under the video.

An edit is a **job like any other**. It is priced from the catalog, debited
before it runs, run by a provider, copied into R2 by the webhook, refunded if
it fails, and listed in the Library. There's no new billing, storage or
auth path.

### Why not OpenCut (or any full editor)

[OpenCut](https://github.com/opencut-app/opencut) was evaluated on
2026-09-22 and rejected for now:

- The working version (`opencut-classic`) was **archived on 2026-05-17**.
  The current repo is a **ground-up rewrite** and isn't production-ready.
- It's a standalone app with its **own Postgres, Redis and auth**, so it
  would need separate hosting and a second login alongside Supabase.
- Its engine runs as **WebAssembly in the browser**. Our CSP doesn't allow
  that, and allowing it needs an ADR.
- Its embeddable "Editor API" is **roadmap only**.

It's MIT-licensed, so it's worth revisiting when the Editor API ships.
Nothing here blocks that.

## 2. Why this shape

- **No new runtime.** fal hosts ffmpeg as ordinary queued endpoints, so an
  edit is a job with a webhook, like a generation. No WebAssembly, and no
  CSP change: the browser never fetches R2 bytes itself.
- **One charge per edit.** `compose` does stitch, tail-trim and audio in a
  single call, so a typical edit is one job and one debit, not a chain.
- **Low content risk.** v1 only edits the user's **own** generated
  Assets. It creates no new faces, voices or likenesses, which matters for
  the payment-provider review (see #101).

## 3. Scope

### In (v1)
| Edit | What the user does | Runs on |
|---|---|---|
| Stitch | Picks 2–10 of their video clips in the Library and orders them | `fal-ai/ffmpeg-api/compose` (one video track) |
| Tail trim | Sets an end point on any clip in the edit | same `compose` call (keyframe `duration`) |
| Add audio | Picks one of their audio generations and a start offset | same `compose` call (second track, audio) |
| Head trim | Sets a start point on a clip | `fal-ai/workflow-utilities/trim-video` first, as a separate priced job |

### Out (v1)
- A multi-track timeline, transitions, text/captions, keyframed effects,
  speed changes, colour.
- **Uploaded media.** v1 edits generated Assets only. Uploads would bring
  user-supplied content, moderation and likeness questions (see the Face
  Filters PRD).
- Editing another user's Assets, shared projects, collaboration.
- Real-time preview of the combined result. The preview is the individual
  clips; the rendered output is the result.

## 4. User flow

1. **Library → select.** The user ticks 2+ video Assets. A bar appears:
   **Stitch (n)**.
2. **Edit sheet.** The ordered list of clips, each with:
   - drag to reorder
   - a native `<video>` player with **in/out handles**. The out handle maps
     to `compose` `duration`; an in handle other than 0 adds a trim job.
   - remove from edit
3. **Audio (optional).** "Add audio" opens the user's audio Assets. Pick
   one, then set **Start at** (seconds, default 0). The audio is cut to the
   video's length.
4. **Price.** The button shows the total credit cost before submit, as
   everywhere else: `Create video · 12 cr`. If a head trim is needed, the
   cost line itemises it.
5. **Submit.** The result lands in the Library as a new video Asset, linked
   to its source Assets.

Mobile follows the same flow as full-screen steps.

## 5. How it runs

### Request
`POST /api/v1/edits` (same gateway rules as `/api/v1/generations`: JWT,
rate limit, idempotency key, typed errors):
```json
{
  "idempotency_key": "…",
  "clips": [
    { "asset_id": "uuid", "in_s": 0,   "out_s": 5.0 },
    { "asset_id": "uuid", "in_s": 1.5, "out_s": 8.0 }
  ],
  "audio": { "asset_id": "uuid", "offset_s": 0 }
}
```

### Server steps
1. **Validate at the boundary.** 2–10 clips. Every `asset_id` exists, is a
   `video` Asset (`audio` for the audio slot) and **belongs to the caller**,
   checked through the same ownership rule as `get_user_asset`. `0 ≤ in_s <
   out_s ≤ source duration`. Total output ≤ **60 s** (v1 cap). Anything else
   → `400 {error: "…"}`.
2. **Price** from the catalog (§6) and debit through the normal ledger
   path. The debit and the job row are written together, keyed on
   `(user_id, idempotency_key)`.
3. **Head trims first.** For each clip with `in_s > 0`, submit a
   `trim-video` job and wait for its webhook to store the trimmed clip in R2.
4. **Compose.** Build `tracks`: one `video` track whose keyframes are laid
   end to end (`timestamp` = running total in ms, `duration` = `(out_s −
   in_s) × 1000`), plus an optional `audio` track. Each `url` is a
   **presigned R2 GET** minted server-side for this job.
5. **Webhook → R2 → Library.** It uses the existing fal webhook, signature
   check, `webhook_events` dedupe and `copyUrlToR2`. The output's host is on
   fal's CDN, which is already allowlisted.
6. **Failure at any step** refunds the whole edit through `ledger_refund`,
   including when a head trim succeeded but the compose failed.

### Constraints this relies on (verify in Slice 0)
- **Presigned URL lifetime.** R2 GETs are capped at 15 minutes
  (CLAUDE.md). fal has to fetch the inputs before they expire. If its queue
  delay can exceed that, the job must fail and refund, never hang.
- `compose` behaviour **not yet observed**: does `duration` shorter than
  the clip truncate cleanly? Is audio longer than the video cut or
  extended? What happens with mixed aspect ratios and frame rates? Test
  each before `active = true`.
- `merge-videos` is the fallback if `compose` misbehaves. It stitches but
  can't trim or add audio, so it would mean more jobs per edit.

## 6. Pricing

- Two new `model_catalog` rows: `edit-compose` and `edit-trim`, priced in
  `credits_5s` **per 5 s of output**, like video.
- **fal's price for these endpoints isn't published in its model index.**
  Measure it on real calls in Slice 0 and set credits above the ADR-0014
  floor, as for any row. Never price in the app layer.
- Expected to be cheap relative to generation. ffmpeg time is small next to
  model time. The price should still cover fal's charge plus margin, and
  must never be free: free edits would be an abuse path.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Presigned URLs expire before fal fetches them | Verify fal's queue latency in Slice 0; fail and refund on source 403 |
| A multi-job edit (head trims + compose) half-completes | One edit = one debit, one refund covering everything; trimmed intermediates are swept by the ADR-0008 retention job |
| Output exceeds `copyUrlToR2`'s 100 MB cap | The 60 s v1 cap keeps output well under it; re-check with real bitrates |
| Users stitch clips of different aspect ratios | Validate and reject in v1, or let `compose` pick the first clip's; decide after Slice 0 |
| Cost surprises | The price is shown before submit; the per-5-s price scales with output length |

## 8. Delivery

| Slice | What | Done when |
|---|---|---|
| 0 | Call `compose` and `trim-video` live with real Assets; record price, latency and behaviour for the §5 questions | Answers written into this doc |
| 1 | Catalog rows (inactive), `POST /api/v1/edits`, validation, ownership, debit/refund, webhook path | Acceptance tests cover the debit→refund and idempotent-replay paths |
| 2 | Library multi-select, edit sheet, in/out handles, audio picker | A user makes a stitched video with audio end to end |
| 3 | Rows `active = true` after verification (ADR-0011), behind a `localStorage.veyrnox_editor` flag for 24 h, then open to everyone | Reconciliation clean for 24 h |

**Money spine rule:** Slice 1 touches jobs and the ledger, so it needs its
ADR update (CLAUDE.md "Delivery") before merge.

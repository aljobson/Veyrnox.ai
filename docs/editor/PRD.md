# PRD — Clip Editor (stitch, trim, add audio)
**Status:** Draft · 2026-09-22 · Slice 0 done (live results in §9) · Slice 1a (orchestrator, 0092) merged in #235
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

An edit is **one priced job made of a short chain of fal ffmpeg steps**. It's
debited once before it runs, refunded in full if any step fails, stored in
R2 by the existing webhook path, and listed in the Library. There's no new
billing, storage or auth path.

**It runs on the `job_steps` table Auto Short built** (migration 0091, per
ADR-0029): a parent `jobs` row plus one `job_steps` row per provider call,
advanced by signed webhooks, with one debit and an all-or-nothing refund.
There's no second engine. Migration 0092 adds the editor's step kinds
(`trim`, `merge`, `audio`). The editor is the simplest user of that table:
pure ffmpeg steps, no AI generation.

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

- **No new runtime.** fal hosts ffmpeg as ordinary queued endpoints, so each
  step is a job with a webhook, like a generation. No WebAssembly, and no
  CSP change: the browser never fetches R2 bytes itself.
- **Only the exact tools.** Slice 0 found that `compose` (one call for
  everything) **ignores the durations it's given and distorts portrait
  clips**. The three single-purpose endpoints hit their timings to the
  frame (§9), so the design chains those.
- **Low content risk.** v1 only edits the user's **own** generated
  Assets. It creates no new faces, voices or likenesses, which matters for
  the payment-provider review (see #101).

## 3. Scope

### In (v1)
| Edit | What the user does | fal step |
|---|---|---|
| Trim | Sets in/out points on a clip | `fal-ai/workflow-utilities/trim-video` (skipped when the clip is used whole) |
| Stitch | Picks 2–10 of their video clips **of the same aspect ratio** and orders them | `fal-ai/ffmpeg-api/merge-videos` |
| Add audio | Picks one of their audio generations and a start offset | `fal-ai/ffmpeg-api/merge-audio-video` |

A single-clip edit can be just a trim, or just audio. Steps run in the
order trim → stitch → audio, and only the steps the edit needs.

### Out (v1)
- **Mixed aspect ratios.** `merge-videos` squashes a landscape and a
  portrait clip into a distorted square (§9, T9), so v1 rejects the mix.
  Letterboxing would need its own step and is later work.
- A multi-track timeline, transitions, text/captions, keyframed effects,
  speed changes, colour.
- **Uploaded media.** v1 edits generated Assets only. Uploads would bring
  user-supplied content, moderation and likeness questions (see the Face
  Filters PRD).
- Editing another user's Assets, shared projects, collaboration.
- A real-time preview of the combined result. The preview is the individual
  clips; the rendered output is the result.
- `fal-ai/ffmpeg-api/compose`. Rejected in Slice 0 (§9).

## 4. User flow

1. **Library → select.** The user ticks 1+ video Assets. A bar appears:
   **Edit (n)**. If the clips' aspect ratios differ, the bar says so and
   blocks stitching them.
2. **Edit sheet.** The ordered list of clips, each with:
   - move earlier / later (buttons in v1; drag later)
   - a native `<video>` player with **in/out handles** (maps to
     `trim-video` `start_time` / `end_time`)
   - remove from edit
3. **Audio (optional).** "Add audio" opens the user's audio Assets. Pick
   one, then set **Start at** (seconds, default 0). The audio is cut to
   the video's length automatically.
4. **Price.** The button shows the total credit cost before submit, as
   everywhere else: `Create video · 3 cr`, from `clip-edit`'s `credits_5s`
   and the output length.
5. **Submit.** The edit appears at the top of the Library as RUNNING and
   lands there as a new video Asset. A per-step progress line (trimming →
   stitching → adding audio) needs the job API to expose steps; it is later
   work.

Mobile follows the same flow as full-screen steps.

## 5. How it runs

### Request
An edit is an ordinary generation. It goes to `POST /api/v1/generations`
with `model_id: "clip-edit"`, so it gets the gateway's JWT check, rate limit,
idempotency key, catalog lookup, capability record (ADR-0027) and typed
errors with no second endpoint. The catalog row's provider is the `veyrnox`
pseudo-provider, the same path Auto Short's parent uses.
```json
{
  "model_id": "clip-edit",
  "idempotency_key": "…",
  "inputs": {
    "clips": [
      { "asset_id": "uuid", "in_s": 0,   "out_s": 5.0 },
      { "asset_id": "uuid", "in_s": 1.5, "out_s": 8.0 }
    ],
    "audio": { "asset_id": "uuid", "offset_s": 0 }
  }
}
```
An `asset_id` is the id of the job that produced the Asset, the same id
`get_user_asset` takes. `clips` and `audio` are structured, so they get
their own schema check at the boundary (`lib/clipEditSources.js`).

### Server steps
1. **Validate at the boundary.** 1–10 clips; with one clip there has to be
   a trim or audio, or there's nothing to do. Every `asset_id` exists, is a
   `video` Asset (`audio` for the audio slot) and **belongs to the caller**,
   checked through the same ownership rule as `get_user_asset`. `0 ≤ in_s <
   out_s ≤ source duration`. **All clips share one aspect ratio.** Total
   output ≤ **60 s** (v1 cap). Anything else → `400 {error: "…"}`.
2. **Price** from the catalog (§6) and debit **once** through the normal
   ledger path. The debit and the job row are written together, keyed on
   `(user_id, idempotency_key)`. The validated edit (R2 keys, in/out
   points, audio offset) is stored in `jobs.inputs.edit`.
3. **Trim.** For each clip whose in/out isn't its full length, submit
   `trim-video` against a **presigned R2 GET** for the source. Clips used
   whole skip this step.
4. **Stitch** (2+ clips): submit `merge-videos` with the clips' presigned
   URLs in order.
5. **Audio** (if set): submit `merge-audio-video` with `start_offset` =
   `offset_s`.
6. **Store.** Every step's webhook runs the existing path: signature check,
   `webhook_events` dedupe, then `copyUrlToR2` into
   `edits/<job id>/<step>-<n>.mp4` and `job_step_stored`. The next step
   reads its input from that R2 copy through a fresh presigned URL, so no
   step depends on how long fal keeps its CDN files. After the last step,
   `job_stored` marks the parent done with the final output.
7. **Failure at any step** is retried once. A second failure fails the
   parent and refunds the whole edit once through `ledger_refund`. The edit
   is one charge, so a partial chain is never billed.

**Steps run strictly one at a time**, in the order trim (by clip) → stitch →
audio. Each step is submitted by its predecessor's webhook, so there's only
ever one step in flight. That's deliberate: nothing fans in, so two
callbacks can never race to submit the next step (the missing claim on
0091, raised on #230). The edit is rebuilt from `jobs.inputs.edit` on every
callback, never from the provider's payload.

A lost callback is caught by the step sweep (#233): a step still submitted
after 12 minutes is re-read from fal and applied as if its callback had
arrived, and one pending after 30 minutes counts as failed.
`sweep_stuck_jobs` stays the backstop for the parent at 120 minutes.

## 6. Pricing

fal's prices (pricing API, 2026-09-22) and the compute measured in §9:

| Step | fal price | Measured compute | fal cost per step |
|---|---|---|---|
| `trim-video` | $0.001 / compute-second | 4.9 s | ≈ $0.005 |
| `merge-videos` | $0.00017 / compute-second | 7.5–11.6 s | ≈ $0.002 |
| `merge-audio-video` | $0.0002 / second | 6.1–7.6 s | ≈ $0.002 (or up to $0.012 if billed per output second on a 60 s video) |

A heavy v1 edit (4 trims, stitch, audio) costs about **$0.03** at fal.

**Pricing rule (ADR-0029, decision 2; CLAUDE.md "Money & billing"):** one
catalog row, one debit, and the app never adds up step prices. So the
editor is **one row, `clip-edit`**, priced like every video row: `credits_5s`
per started 5 s of **output**. The price doesn't depend on how many steps an
edit needs. Proposed: **1 credit per 5 s of output** (a 15 s edit = 3
credits; the 60 s cap = 12 credits).

Checked against ADR-0014's floor (50% margin at $0.033/credit) for the
worst case, where every clip is trimmed and there's audio:

| Output | Worst fal cost (trims + stitch + audio) | Price at $0.033 | Margin |
|---|---|---|---|
| 5 s, 1 clip trimmed + audio | ≈ $0.005 + $0.002 = $0.007 | 1 cr = $0.033 | ≈ 79% |
| 15 s, 3 clips all trimmed + audio | ≈ $0.015 + $0.002 + $0.003 = $0.020 | 3 cr = $0.099 | ≈ 80% |
| 60 s, 10 clips all trimmed + audio | ≈ $0.050 + $0.002 + $0.012 = $0.064 | 12 cr = $0.396 | ≈ 84% |

Every case clears the floor. Never free, because free edits would be an
abuse path. The price lives in the catalog and gets re-checked if fal's
prices change.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Presigned R2 URLs (15-min cap) expire before fal fetches them | Measured queue wait **0.2–3.4 s**, total per step **≤ 14 s**, a very wide margin. Still fail and refund on a source 403, never hang. |
| A chain half-completes | One debit, one refund covering everything. Intermediates are copied to R2 under the job, so a retry never depends on fal's CDN |
| Mixed aspect ratios | Rejected at validation (§9, T9) |
| `merge-videos` drops to the lowest input frame rate | Acceptable (T6: 30 + 24 fps → 24 fps). Say so in the UI if a user mixes rates. |
| Output exceeds `copyUrlToR2`'s 100 MB cap | The 60 s v1 cap keeps output well under it; re-check with real 1080p bitrates |
| Chain length adds latency | Steps run one at a time (§5), so the longest edit is 10 trims + stitch + audio = 12 steps at ≤ 14 s each, about 3 minutes; a typical 2–3 clip edit is under a minute. Show progress per step. Running trims in parallel needs the claim fix first. |
| A callback never arrives | The step sweep (#233) re-reads the step from fal after 12 minutes; the parent sweep refunds at 120 minutes |

## 8. Delivery

| Slice | What | Done when |
|---|---|---|
| 0 | ~~Call the endpoints live; record price, latency, behaviour~~ | **Done 2026-09-22 (§9)** |
| 1a | ~~Orchestrator on main's `job_steps`: validation, plan, one-at-a-time steps, retry then a single refund, webhook routing by step kind; migration 0092 (step kinds, trim positions 0–9, `clip-edit` row inactive)~~ | **Merged in #235** (unit tests + 0092 acceptance tests) |
| 1b | ~~Gateway wiring: `clip-edit` capability record, `clips`/`audio` schema check, Asset ownership and real source durations, price from output length, `start` from the generations route~~ | **Merged in #240** |
| 2 | Library multi-select, edit sheet, in/out points, audio picker, behind `localStorage.veyrnox_editor` | A user makes a stitched video with audio end to end |
| 3 | Rows `active = true` after verification (ADR-0011), behind a `localStorage.veyrnox_editor` flag for 24 h, then open to everyone | Reconciliation clean for 24 h |

**Money spine rule:** the editor touches jobs and the ledger, so ADR-0029
needs an amendment (CLAUDE.md "Delivery") before Slice 1b merges: the
editor as a second user of `job_steps`, its steps running one at a time,
and `compose` replaced by the three exact endpoints.

## 9. Slice 0 results (2026-09-22, live fal calls)

Test inputs were generated with ffmpeg and hosted on fal storage: A =
1280×720 30 fps 5 s, B = 1280×720 24 fps 8 s, C = 720×1280 (portrait)
30 fps 5 s, S = 20 s audio tone. Outputs were measured with `ffprobe`,
checked frame by frame, and checked for silence.

| # | Call | Expected | Got | Verdict |
|---|---|---|---|---|
| T1 | `compose` A + B with B `duration` 3 s, audio 20 s | 8 s | video **10.43 s**, audio 20.04 s; B started ~1 s late and wasn't cut | ✗ ignores durations |
| T2 | same, audio `duration` 8 s | 8 s | identical to T1 | ✗ audio duration ignored |
| T3 | `compose`, audio at 2 s for 6 s | 8 s | audio 22.04 s | ✗ |
| T4 | `compose` landscape + portrait | 10 s | 10 s, portrait **stretched** to 1280×720 | ✗ distorts |
| T5 | `trim-video` B 2 s → 6 s | 4 s | **4.00 s** | ✓ exact |
| T6 | `merge-videos` A + B | 13 s | **13.00 s**, 24 fps | ✓ exact |
| T7 | `merge-audio-video` 13 s video + 20 s audio | audio cut to 13 s | video 13.00 s, audio **12.98 s** | ✓ |
| T8 | same, `start_offset` 2 s | 2 s silence, then audio | silence **0 → 2.000 s** | ✓ offset delays, doesn't skip |
| T9 | `merge-videos` landscape + portrait | letterbox or reject | **720×720, both distorted** | ✗ reject mixed ratios |

**Latency:** queue wait 0.2–3.4 s; total 5.9–13.9 s per call.
**Cost of the whole run:** under $0.10.

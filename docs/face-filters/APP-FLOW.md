# App Flow — Face Filters

**Status:** Draft · 2026-09-18
**Reads with:** [PRD.md](PRD.md), [TRD.md](TRD.md), [UI-UX.md](UI-UX.md)

Describes the user journey for Track A only. Track B has no flow until its ADR
lands. Existing behaviour is marked *(today)*; new behaviour *(new)*.

## 1. Route map

| Route | Purpose | Auth |
|-------|---------|------|
| `/` | Marketing landing *(today)* | public |
| `/veyrnox/app/create` | Studio — the only place a job is created *(today)* | required |
| `/veyrnox/app/library` | Past generations and their assets *(today)* | required |
| `/veyrnox/app/credits` | Balance, Credit Packs, Top-up history *(today)* | required |
| `/auth/callback` | OAuth fragment handler *(today)* | — |

Filters do **not** get their own route. They are models, and models live in the
Studio. A separate `/filters` page would fork the submit path, the balance
check, the polling loop, and the error surface — four copies of logic that must
never disagree about money.

## 2. Phases

```
Sign in ──► Studio ──► pick mode ──► configure ──► submit ──► poll ──► result ──► Library
                            │                        │
                            └── upload (new) ────────┘
```

## 3. Studio: mode selection *(new)*

The Studio gains one control above the model picker: **Generate** or **Transform**.

- **Generate** *(today's behaviour, default)* — prompt in, media out. Model list
  filtered to `text-to-*` modalities.
- **Transform** *(new)* — a file in, media out. Model list filtered to
  `image-to-image`, `video-to-video`, and `image-to-video`.

Switching mode does not clear the prompt or the uploaded file. A user who
uploads a photo, runs a retouch, then switches to Generate should find their
prompt where they left it.

## 4. Upload *(new)*

Trigger: the drop zone in the Transform panel, by click or drag.

1. Client checks type and size locally and shows the reason for any rejection
   immediately. This is a courtesy, not a control — the server repeats it.
2. Client `POST`s `{content_type, size_bytes}` to the upload endpoint.
3. Server validates against the allowlist, derives the key
   `uploads/{user_id}/{uuid}`, mints a 15-minute presigned PUT, returns
   `{upload_url, key}`.
4. Client `PUT`s the file straight to R2 with the exact declared `Content-Type`.
   Progress is shown; the user can cancel, which abandons the request.
5. Client holds the returned `key` in component state. Nothing is submitted yet
   and nothing has been debited.

Failure at any step leaves the drop zone empty with a typed message and no
credit movement. An upload costs nothing.

**What happens on the way back:** the object is now in R2 under the user's
prefix. It is not a `jobs` row, not an `assets` row, and not visible in Library.
It is reachable only by a presigned GET the server mints for its owner. Uploads
that are never used by a job are swept on the retention schedule.

## 5. Configure

The right rail shows, in order: mode, model, the model's controls, cost, submit.

- Cost is read from the catalog and shown before submit *(today)*.
- If `cost > balance`, the submit button reads **Top up** and routes to
  `/veyrnox/app/credits` instead of submitting *(today's behaviour, reused)*.
- A gated model refuses with `model_gated` before any network call *(today)*.
- In Transform mode with no file uploaded, submit is disabled with the reason
  shown beside it — never a silent no-op.

## 6. Submit

Identical to today. `POST /api/v1/generations` with `{model_id, idempotency_key,
inputs}`. The only difference is the shape of `inputs`:

| Mode | inputs |
|------|--------|
| Generate | `{prompt, aspect_ratio, duration_seconds?}` *(today)* |
| Transform | `{image_url}` or `{video_url}`, plus `prompt` where the model takes a text instruction |

The client never builds the URL. It sends the R2 **key** it holds, and the
server mints the presigned GET at submit time — see TRD §3. The client-side
`image_url` field is populated by the server, not the browser.

Server sequence *(today, unchanged)*: validate inputs → look up the catalog row
→ price → rate limit → `ledger_debit` in one transaction with the `jobs` row →
submit to fal → return `{job_id, state, balance_after}`.

Balance updates immediately from `balance_after` and a `veyrnox:balance-changed`
event refreshes every other balance display on the page *(today)*.

## 7. Poll

*(today, unchanged)* Every 2 seconds, `GET /api/v1/jobs/{job_id}`.

- `succeeded` → `GET /api/v1/jobs/{job_id}/asset` returns a presigned GET; the
  result renders in the canvas. Polling stops.
- `failed` → the error code renders, the refund has already landed, and the
  balance refreshes. Polling stops.
- Anything else → keep polling. Slow models show a wait-time hint.

## 8. Result

The canvas shows the output. For a Transform job it shows **before and after**:
the uploaded source beside the result, so the user can judge the change. This is
the one genuinely new piece of result UI.

Actions: download, run again with different settings, open in Library.

## 9. Library

*(today, unchanged)* Filter jobs appear alongside every other generation. A
Transform job's card shows its source thumbnail so it is distinguishable from a
text-to-image result at a glance.

## 10. Failure paths

| What fails | User sees | Credits |
|-----------|-----------|---------|
| File too large / wrong type | Typed reason in the drop zone | none moved |
| Upload PUT fails or is cancelled | Drop zone resets | none moved |
| Presigned URL expired before submit | "Upload expired, add the file again" | none moved |
| Insufficient balance | Submit becomes **Top up** | none moved |
| Rate limited | Retry-after countdown *(today)* | none moved |
| Provider rejects the submit | Typed error, debit reversed *(today)* | debit + refund |
| Provider fails after accepting | Job `failed`, auto-refund *(today)* | debit + refund |
| Result fails to store in R2 | Job `failed`, auto-refund *(today)* | debit + refund |

## 11. Deletion

A user deleting a generation from Library deletes the result asset *(today)*.
Deleting the **source upload** is separate: the upload is not an asset row, so
it has no Library card. Sources are removed on the retention sweep and on
account closure. If a user needs on-demand source deletion before launch, that
is a scope addition, not an implied behaviour.

# App Flow — Face Filters

**Status:** Updated 2026-10-20 against local `origin/main` at `4ccfbd2a1d4b39c8e20db9a0c5269ddab8f908bd`; the Face Filters sources are identical in this checkout (`cf1573bf`). Activation is **merged; production application not verified from the repo**.
**Reads with:** [PRD.md](PRD.md), [TRD.md](TRD.md), [UI-UX.md](UI-UX.md)

*Current implementation: upload, submit and poll reuse the generation spine.
The Generate/Transform switch (§3), comparison (§8) and Library source thumbnail
(§9) remain proposals. Catalog availability is described below; production has
not been read.*

Describes the user journey for Track A only. Track B has no flow until its ADR
lands. Current behaviour is described directly; unbuilt designs are marked *proposed*.

**Current catalog state (2026-10-20, `4ccfbd2a`):** 0356 stages A1-A5;
0357 activates A1 `face-retouch`, A2 `face-enhance`, A4 `face-makeup` and A5
`face-age`, each at 3 credits / $0.0400 recorded provider cost. A3 `face-relight`
stays inactive at 7 credits / $0.1000: the unpinned probe billed 2 MP ($0.20);
a run with the pinned 1000×1000 canvas is still required. A6 is not staged;
A7/A8 are absent and blocked by PRD §6. These are migration states, not a
production read. The web uses Studio models and the per-slot `SourcePickers`
upload field; **a Transform mode does not exist**. Web and phone Tools entries
come from the active catalog. The dedicated phone flow is
[planned until the build PR merges](../mobile/spec/FACE-FILTERS.md).

**Upload admission:** `lib/uploadAdmission.js` has no enrolled matching provider.
`UPLOAD_HASH_MATCH_REQUIRED` is absent from the production vars in the checked-in
`wrangler.jsonc` (default off), while `UPLOAD_INTEGRITY_ENABLED` and
`UPLOAD_REQUEST_RATE_LIMIT_ENABLED` are `"true"`. These are repository settings,
not verified deployed values. Requiring hash matching now fails closed:
`upload_admission_unavailable` at upload issuance, `source_not_admitted` when
resolving an uploaded source for a generation. This seam is not a scanner and
catalog activation does not establish that the public-upload admission gate is met.

## 1. Route map

| Route | Purpose | Auth |
|-------|---------|------|
| `/` | Marketing landing *(today)* | public |
| `/veyrnox/app/create` | Studio — the only place a job is created *(today)* | required |
| `/veyrnox/app/library` | Past generations and their assets *(today)* | required |
| `/veyrnox/app/credits` | Balance, Credit Packs, Top-up history *(today)* | required |
| `/auth/callback` | OAuth fragment handler *(today)* | — |

*2026-10-08: a `/tools` page now exists (#456). It lists, from the live catalog, the models that start from your own file (upscale, background removal, expand, prompt editing, photo to video, talking avatar, lip sync), each linking into the Studio. It is a directory, not a second submit path, so the paragraph below still holds.*

Filters do **not** get their own route. They are models, and models live in the
Studio. A separate `/filters` page would fork the submit path, the balance
check, the polling loop, and the error surface — four copies of logic that must
never disagree about money.

## 2. Phases

```
Sign in ──► Studio ──► pick model ──► configure ──► submit ──► poll ──► result ──► Library
                            │                        │
                            └── upload ────────┘
```

## 3. Studio: mode selection *(proposed, not built)*

There is no Generate/Transform control. Filters are models in the existing
Studio, with a per-slot `SourcePickers` upload field and “From library” for
owned results. `/tools` links to that same Studio with the model selected;
`app/veyrnox/_lib/tools.js` supplies the Face filters group, not a submit route.

The original proposal was a Generate/Transform toggle above the model picker,
filtering text-to-* versus source-based modalities while preserving the prompt
and upload across switches. This remains unbuilt, not a requirement to launch
the four activated models. The phone's dedicated flow is also planned until its
build PR merges; see [FACE-FILTERS.md](../mobile/spec/FACE-FILTERS.md).

## 4. Upload *(built)*

*2026-10-08: built, with a different front end (the Studio's per-slot upload field, ADR-0028, #217). Differences from the steps below: step 2 is refused with `insufficient_credits` (402) for a zero balance, is rate limited (ADR-0035) and capped at 10 unconsumed uploads; the allowed types now include audio; and the submit in §6 must carry `consent: true`.*

Trigger: the Studio per-slot file picker. There is no Transform panel.

1. Client checks type and size locally and shows the reason for any rejection
   immediately. This is a courtesy, not a control — the server repeats it.
2. Client `POST`s `{content_type, size_bytes}` to `/api/v1/uploads`.
   Upload admission runs before reservation/signing; see the current flag note above.
3. Server validates against the allowlist, derives the key
   `uploads/{auth_id}/{uuid}.{ext}`, mints a 15-minute presigned PUT, returns
   `{upload_url, key, expires_in}` (`expires_in: 900`).
4. Client `PUT`s the file straight to R2 with the exact declared `Content-Type`.
   Progress is shown; the user can cancel, which abandons the request.
5. Client holds the returned `key` in component state. Nothing is submitted yet
   and nothing has been debited.

Failure at any step leaves the drop zone empty with a typed message and no
credit movement. An upload costs nothing.

**What happens on the way back:** the object is now in R2 under the user's
prefix. It is not a `jobs` row, not an `assets` row, and not visible in Library.
The server resolves it internally for provider submission; job/asset reads do
not return the original. Abandoned uploads are swept at 24 hours. Consumed
uploads are swept after a terminal job on the five-minute cron, with a
16-minute job-age guard so a still-valid PUT cannot recreate a deleted source.
Missed cleanup runs fall back to the age sweep; these are not exact deadlines.

## 5. Configure

The Studio uses its existing model picker, declared controls, source fields,
cost and submit. The proposed mode control is absent. Per-model input contracts
are in `lib/additionalModelCapabilities.js`; do not infer that a dedicated
makeup or age selector UI has shipped from the server accepting those fields.

- Cost is read from the catalog and shown before submit *(today)*.
- If `cost > balance`, Generate is disabled and the insufficient-credit panel
  links to `/app/credits` (`app/veyrnox/app/create/page.js`).
- A gated model refuses with `model_gated` before any network call *(today)*.
- A model with a required media slot needs a source; submit is disabled with the reason
  shown beside it — never a silent no-op.

## 6. Submit

`POST /api/v1/generations` uses `{model_id, idempotency_key, inputs,
source_key, consent: true}` for a single uploaded photo. `source_keys` supports
slot descriptors; `source_assets` references owned Library jobs. Source fields
and consent are top-level, not `inputs`. `confirmed_credits` optionally pins
the displayed quote (the phone uses it); a changed price returns
`credit_confirmation_mismatch` before debit.

A1/A2 allow optional `seed`; A4 takes `makeup_style` / `intensity` (defaults
`natural` / `medium`); A5 takes integer `target_age` 18-100 (default 30).
A5's `preserve_identity` is server-fixed true; do not send it as a selector.
A3's required prompt and optional seed are inactive. No quantity/tier knobs.
The server, not the client, supplies provider URLs. Client `image_url` and
`video_url` values are dropped after outer validation; stored inputs contain
source keys, never presigned credentials.

The rights statement version is `aup-2026-09-26`, supplied by the server when
recording `consent: true`; there is no client wording-version request field.

Server order: validate → rate gate → source references and consent → active
catalog/model capability lookup → resolve/admit/inspect source → validate
model inputs and quote → ledger debit/job transaction → provider dispatch.
A replay with the same idempotency key must reuse the existing job, not create
a second charge. The success response includes `{job_id, state, balance_after}`.

Balance updates immediately from `balance_after` and a `veyrnox:balance-changed`
event refreshes every other balance display on the page *(today)*.

## 7. Poll

*(today, unchanged)* Every 2 seconds, `GET /api/v1/jobs/{job_id}`.

- `succeeded` → `GET /api/v1/jobs/{job_id}/asset` returns a presigned GET; the
  result renders in the canvas. Polling stops. Only stored output maps to
  public `succeeded`.
- `failed` → show the typed failure and refresh balance. Say “refunded” only
  when `refunded: true` is returned; `FAILED` can precede `REFUNDED`.
- `queued` / `running` → keep polling. `useStudioJobs` stops after 30
  consecutive failed poll ticks with an unreachable notice; this is not proof
  the job failed and must not trigger a second submit.

## 8. Result

The web canvas shows output only. Before/after remains proposed; no Transform
result view exists. The phone plan compares a temporary local original with the
output only in the immediate result view. It clears that original on closing
the view, expiry, sign-out or account change; restart/Library reopen is output
only. Persistent comparison requires a separate storage/API decision.

Actions: download, run again with different settings, open in Library. On the
phone: **Open in Library** and optional **Save to Photos**. Neither is an extra
server-side Library-save operation.

## 9. Library

Stored filter outputs appear alongside other generations automatically through
the webhook handler and `job_stored` (0077). A source thumbnail inset was
proposed but is not implemented; originals are not exposed by job/asset reads.

## 10. Failure paths

| What fails | User sees | Credits |
|-----------|-----------|---------|
| File too large / wrong type | Typed reason in the drop zone | none moved |
| Zero balance when asking for an upload URL *(2026-10-08)* | `insufficient_credits`, no URL issued | none moved |
| Admission required, no matcher | `upload_admission_unavailable` on upload; `source_not_admitted` on submit | none moved |
| Provider content/input refusal | `provider_moderation` / `provider_input_rejected` | rejected submit refunded; read job refund state for later failure |
| Source attached without the consent statement *(2026-10-08)* | `consent_required` | none moved |
| Upload PUT fails or is cancelled | Drop zone resets | none moved |
| Upload source missing or unreadable | `source_not_found` / `source_unreadable`; ask to upload again | none moved |
| Insufficient balance | Generate disabled; credit panel links to top-up | none moved |
| Rate limited | Retry-after countdown *(today)* | none moved |
| Provider rejects the submit | Typed error, debit reversed *(today)* | debit + refund |
| Provider fails after accepting | Job `failed`, auto-refund *(today)* | debit + refund |
| Result fails to store in R2 | May remain running during retries; terminal failure uses the refund path | Do not claim refund until confirmed |

## 11. Deletion

A user deleting a generation from Library deletes the result asset *(today)*.
Deleting the **source upload** is separate: the upload is not an asset row, so
it has no Library card. Sources are removed on the retention sweep. Account-closure
cleanup is unverified; it must not be promised. If a user needs on-demand source deletion before launch, that
is a scope addition, not an implied behaviour. *2026-10-08: account-closure deletion of uploads was not found in code (unverified).*

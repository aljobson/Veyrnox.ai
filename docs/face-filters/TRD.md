# TRD — Face Filters & Media Authenticity

**Status:** Draft · 2026-09-18
**Reads with:** [PRD.md](PRD.md), [SCHEMA.md](SCHEMA.md), [../../CLAUDE.md](../../CLAUDE.md)

The stack is already chosen and running. This document records only what
changes, and the decisions an agent would otherwise have to guess at.

## 1. Inherited stack — do not re-litigate

| Layer | Choice | Where |
|-------|--------|-------|
| Runtime | Next.js on Cloudflare Workers via OpenNext | `open-next.config.ts`, `wrangler.jsonc` |
| Auth | Supabase Auth, ES256 JWT verified with Web Crypto + JWKS | `middleware.js` |
| Database | Supabase Postgres (Frankfurt), service-role from the Worker only | ADR-0006 |
| Object storage | Cloudflare R2, EU jurisdiction, SigV4 signed with Web Crypto | `packages/adapters/r2.js`, ADR-0021 |
| Generation provider | fal.ai, queued + Ed25519-signed webhook | `packages/adapters/fal.js` |
| Billing | LemonSqueezy | ADR-0003, ADR-0018 |
| Styling | Tailwind over CSS custom properties | `tailwind.config.js`, `app/globals.css` |

Three libraries break the Workers build and must not appear: `tsx` in root
devDependencies, `jose` anywhere on the SSR graph, `@supabase/supabase-js` in
anything `packages/studio` drags in. See CLAUDE.md.

## 2. Decision: uploads use a presigned R2 PUT, not a Worker proxy

**Chosen.** The browser asks the Worker for a short-lived presigned PUT URL and
uploads straight to R2.

Rejected alternatives:

- *Proxy the bytes through the Worker.* Simple, but a Worker request has a body
  size ceiling and burns CPU time on every megabyte for no benefit.
- *Restore `/api/v1/get_upload_url` as it was.* It proxied to `api.muapi.ai`.
  That brand is gone (ADR-0007). The route stays 410; the new one is a new path.

Consequences:

- `packages/adapters/r2.js` gains `presignPutUrl(key, contentType, expiresSeconds, cfg)`,
  built on the existing `signingKey` / `rfc3986` SigV4 helpers. No new crypto.
- The Worker, not the client, picks the R2 key: `uploads/{user_id}/{uuid}`.
  A user-controlled path is forbidden by CLAUDE.md, and the `user_id` prefix is
  what makes ownership checkable later.
- The presigned PUT carries a fixed `Content-Type` and the client must send the
  same one, so the signature pins the declared type.
- TTL 15 minutes, matching the presigned GET ceiling in CLAUDE.md.

## 3. Decision: fal reads the upload through a presigned GET

fal needs an HTTPS URL it can fetch. The Worker mints a presigned GET on the
uploaded object at submit time and puts it in `inputs.image_url`.

- TTL 15 minutes — the job is submitted immediately after.
- The URL is never stored in `jobs.inputs`; the **R2 key** is stored, and the
  presigned URL is derived at submit. A signed URL in a JSONB column is a
  credential with a long tail.
- `isAllowedSourceHost` in `packages/adapters/r2.js` is unchanged. It governs
  `copyUrlToR2` (result ingestion), which is a different direction of travel.

## 4. Decision: validate the upload server-side, twice

A declared `Content-Type` is a claim. The gate is:

1. **Before signing** — the requested MIME must be in an allowlist
   (`image/jpeg`, `image/png`, `image/webp`, `video/mp4`), and the declared size
   under a per-type cap. Reject with a typed error, never a 500.
2. **After upload, before submit** — the Worker HEADs the object and reads the
   first bytes to confirm the magic number matches the declared type. A `.mp4`
   that is really an HTML file must never reach a provider or a presigned GET.

Rate limit uploads at the entry point on the existing Postgres sliding window,
the same mechanism as `check_generation_rate_limit`.

## 5. Decision: filters are catalog rows, not a new subsystem

A filter is a `model_catalog` row. It reuses, unchanged:

- pricing from `credits_5s` (the catalog is normative — CLAUDE.md),
- `ledger_debit` / `ledger_refund`,
- `jobs` and its state machine,
- the fal webhook, `webhook_events` dedupe, and `copyUrlToR2` storage,
- the Library page.

No new table, no new RPC, no new webhook for Track A.

Two code changes are needed:

- **`modality`.** Filters are `image-to-image` and `video-to-video`, neither of
  which exists in the catalog today. `kindOf()` in `app/veyrnox/_lib/tokens.js`
  already handles them correctly — `video-to-video` contains "video", so it
  buckets as video; `image-to-image` falls to the image default. `priceFor()` in
  `app/api/v1/generations/route.js` tests `modality.endsWith('video')`, which is
  true for `video-to-video`, so a video filter is priced per 5s unit. Both are
  correct by accident; add a test that pins the behaviour before relying on it.
- **`ALLOWED_INPUTS`.** Add `video_url` with the same `kind: 'url'` rule as
  `image_url`, for A6. Add nothing else. The comment in that file explains why
  quantity knobs are absent — that reasoning still holds.

## 6. Decision: no per-filter parameters at launch

Filter-specific knobs (strength, blend weight, expression weight) stay out of
`ALLOWED_INPUTS` for the launch set. Every key added there is forwarded verbatim
to the provider and is a surface the catalog price has to cover. Ship the
provider defaults; add a knob only when a measured user need justifies pricing it.

## 7. Track B — not designed here

Track B needs an ADR before a TRD. The decision it must settle:

- Which vendor, and on what contract.
- Whether a verdict is a `jobs` row with a new state, or a separate table. It
  cannot be an `assets` row: `assets` describes R2 objects with a MIME type and
  a size, and a verdict is neither.
- How a probabilistic verdict is worded in the UI so it is not read as fact.
- Whether verdicts are retained at all, given they are assertions about
  identifiable people.

Do not begin Track B implementation from this document.

## 8. Security requirements specific to this feature

- The presigned PUT URL is minted only for the authenticated caller's own
  `user_id` prefix. The Worker derives `user_id` from `x-veyrnox-auth-id`,
  which `middleware.js` overwrites on every request.
- A presigned GET on an upload is minted only for the owner's own object.
  Reuse the ownership check pattern of `get_user_asset`.
- Upload keys are random UUIDs. Never a filename from the client.
- Every rejection is a typed `{error: "kebab_case_code"}` — no vendor payloads,
  no stack traces.
- An upload that fails magic-number validation is deleted, and the failure is
  `console.error`'d as a security-relevant event.

## 9. Testing

- Unit: MIME allowlist, size cap, magic-number check, key derivation.
- Unit: `priceFor()` and `kindOf()` against `image-to-image` and `video-to-video`.
- Integration: upload → presign → submit → webhook → asset, against local
  Postgres per the ledger acceptance test harness.
- Idempotency: replaying the same `idempotency_key` after an upload must not
  debit twice.
- Refund: provider failure on a filter job refunds the exact debit.

# ADR-0274: Mobile Publish connect, inbox and composer depth

Status: Proposed implementation; independent inspection pending.

## Scope

Implement the frozen work order (SHA256 `52e89ef3f63b07c250e975e8005dfad9b006fc9fccfda8fc0158bba0ed73dd15`) in this checkout only. Changes are phone code, translations, regression tests and this ADR. No server, flags, migrations, deployment, dependencies or publishing changes. The work order explicitly reserves ADR-0274 for later numbering.

## Connect

`app/api/v1/social/accounts/route.js:97` returns network readiness. `lib/social/networkReadiness.js:23` distinguishes available, setup-required, testing-disabled and unreleased networks. The phone uses the ordered keys in `lib/social/networks.js:20` (the catalogue excludes Pinterest) and its own labels. A missing readiness array or failed load retains the unchanged four-network fallback. Setup-required networks are disabled.

`app/social/connect/mobile/[network]/route.js:18` permits every OAuth network but excludes credential networks. Existing OAuth authentication-session handling is reused. `lib/social/extendedConnect.js:81` consumes Facebook/Google resource selections; `:106` rejects empty or excessive candidate lists, and `:119` returns the chooser. The phone accepts a UUID selection and 1–200 candidates, validates resource IDs, strips control characters and bounds labels to 120 characters.

Bluesky is a credential network (`lib/social/networks.js:14`). Its server validation is in `lib/social/extendedConnect.js:93`; `packages/adapters/social/bluesky.js:24` exchanges the app password once for session tokens. Only those tokens are encrypted when recording the account (`lib/social/extendedConnect.js:63`). The phone clears its controlled password field before awaiting the exchange, disables autofill, and never caches, logs, attaches to telemetry or puts the password in a URL. Its help describes creating an app password; the OAuth-only password claim is kept above the OAuth list.

## Inbox

`app/api/v1/social/inbox/[threadId]/route.js:91` accepts exactly one trimmed note field, 1–2000 characters, and `:93` authorizes owner, manager, editor and reviewer. Notes have no idempotency key. A failed write retains the draft and reloads the thread once; no automatic write retry occurs.

`packages/db/schema/supabase/0309_social_inbox_workflow.sql:100` returns network reply capability to readers, not write authorization. The screen separately fetches the brand role and defaults to viewer on error. Suggestions remain readable for every role. Only owner, manager and editor may decide them (`app/api/v1/social/inbox/[threadId]/suggestions/route.js:47`); Use also requires the network's reply capability.

Suggestions cost nothing: `packages/db/schema/supabase/0320_social_inbox_workflows.sql:121` inserts saved keyword-workflow text, `:128` matches keywords, and `:163` merely changes the suggestion status. There is no generation, provider send or credit debit. Use fills the draft; it never sends. Suggestions are hidden on any load failure. Replies in flight or held disable Use, including a decision response arriving after a reply starts.

Every thread, role, note, suggestion and decision result is guarded by API identity and the captured cache-user/brand token. Subscription generations invalidate even an A → B → A round trip. Switching scope clears thread drafts and results.

`app/api/v1/social/inbox/analytics/route.js:16` accepts 7, 30 or 90 days, and `:20` returns summary, platforms, trend and heatmap. The phone renders only the six summary values and platform rows, with finite non-negative numbers and locale formatting; inaccessible analytics degrades to unavailable.

## Reply attempts and R10 follow-up

`packages/db/schema/supabase/0309_social_inbox_workflow.sql:206` returns the existing row for a known key; `:209` inserts a sending row before delivery. `app/api/v1/social/inbox/[threadId]/reply/route.js:19` gates availability, `:25` validates the body, and `:29` rate-limits before creating a reply. `:46` returns idempotent state, `:54` answers sent after delivery, and `:56` records failures.

The phone binds each attempt to its thread, original body and key. A confirmed sent response clears the attempt and draft. A first-send 400/402/403/404/429/503 drops the attempt while preserving the editable draft. Everything else, including transport loss, 409/502, malformed success and idempotent failed/sending, holds the attempt as possibly sent. Once held, even a later refusal keeps the same body/key and locks editing. Send retries that same attempt only on a tap. Send anyway requires confirmation and creates one new key. Discard requires confirmation and unlocks the unchanged draft. Neither matching historical text nor reload results provide delivery evidence.

**Contract deviation:** `apps/mobile/src/lib/api.ts:93` returns successful JSON without the HTTP status. The whitelist forbids changing that shared client, and the existing reply signature and request path are retained. For statusless successful bodies, the phone therefore requires `delivery_status: 'sent'` plus a UUID `message_id`. This accepts both actual route success forms and conservatively holds malformed bodies, including a malformed 201. The pure outcome function also tests explicit 201/200 status envelopes. Proposed future alternative: expose response status from the shared API client in a separately approved change.

**R10 server follow-up:** `app/api/v1/social/inbox/[threadId]/reply/route.js:48` wraps provider delivery and the success-recording RPC in the same catch. A delivered reply can consequently be recorded as failed. `packages/adapters/social/inbox.js:22` also maps a timeout to failure. The server must distinguish delivery uncertainty from definite refusal before the phone can release failed attempts safely. This implementation changes no server behavior.

## Presets and scope

`app/api/v1/social/presets/route.js:13` gates availability; GET/PUT/DELETE use the existing routes, with writes restricted to owner/manager/editor. `packages/db/schema/supabase/0302_social_content_presets.sql:31` defines the read fields; `packages/db/schema/supabase/0308_social_team_publishing.sql:139` caps presets at 50 per brand.

Applying a preset intersects its account IDs with eligible accounts and clears all per-network overrides. Nonempty overrides require confirmation because `packages/db/schema/supabase/0310_social_post_variants.sql:56` gives network text precedence over the global caption. Save uses effective selected accounts and a scope-guarded confirmation, as required by the frozen save-confirm regression case. Queue mode disables Apply and Save because reservation determines destinations; Delete remains available and requires a named destructive confirmation.

Presets and their alerts capture cache-user/brand scope and a generation. Scope changes clear list, selection and name, invalidate requests and confirmations, and reload. The parent clears account IDs, media choices and queue ID, resets accounts to loading, and clears caption/network text if a preset was applied. Typed-only captions retain the existing behavior. Submit confirmations additionally check the same scope before sending and between queue requests, preventing a captured old-brand draft from being sent through the dynamic brand client. Existing submit validation, idempotency payloads and confirmation copy are retained.

## Plan management

`lib/social/publishPlanApi.js:24` exposes only a live subscription's `stripe`/`store` source; it does not identify Apple or Google. The hub queries the caller's base API, not the selected brand API, and shows the existing management sentence only for an actual Publish tier and known source. Per [ADR-0266](0266-mobile-no-web-breakout.md), it has no web link; an unknown store also precludes a correct store-management button. A client-brand entitlement alone does not imply that the caller owns a plan.

## Deliberately omitted

Contacts import, heatmaps/daily charts, per-account analytics filters, tag/priority editing, provider-specific network hints, connected markers, Pinterest, pre-send reply confirmation and store-management buttons remain outside this change. No new browser call, analytics SDK, dependency or cross-account content cache is introduced. All new strings live in the publishDepth area, with ten app translations and no new plural families.

# Veyrnox MCP activation and rollback

The code endpoint is `https://veyrnox.ai/api/v1/mcp`. Do not announce it as live until every check below passes in staging and then production.

## Activate Supabase OAuth 2.1

In the matching Supabase project dashboard:

1. Open Authentication → OAuth Server and enable the OAuth 2.1 server.
2. Enable dynamic client registration. MCP clients register their own redirect URIs; do not add a wildcard Veyrnox redirect.
3. Set the authorization/consent path to `https://veyrnox.ai/oauth/consent` (use the staging origin in staging).
4. Keep PKCE required and confirm the project signs access tokens with the asymmetric key whose public key is in the project's JWKS.
5. Confirm the ordinary Veyrnox sign-in providers and redirect allowlist also permit the consent URL to survive a sign-in round trip.

## Acceptance

Run these without pasting an access token into logs or tickets:

1. `GET https://veyrnox.ai/.well-known/oauth-protected-resource/api/v1/mcp` returns the MCP resource and the expected Supabase `/auth/v1` issuer.
2. An unauthenticated request to `/api/v1/mcp` returns 401 with a `WWW-Authenticate` header naming that metadata URL.
3. The Supabase authorization-server discovery document advertises authorization, token and dynamic-registration endpoints.
4. Connect one disposable MCP client. The browser lands on `/oauth/consent`, shows that client's registered name and scopes, and denial returns to the client as a denial.
5. Approve a new request. `list_models`, `get_balance` and `list_generations` return only that account's data.
6. Ask for one inexpensive generation with `generate_image` (any image model). The client shows the maximum credit estimate before the write. Altered `confirmed_credits` is refused without a debit; the correct amount creates one job; retrying the same idempotency key returns the same job. A video or audio model, or a model above 2 credits, is refused before any debit (`mcp_image_only`, `mcp_price_cap`). There is no daily cap (ADR-0100 amendment 3): spend is bounded by the account balance, the generation route's rate limit and the 2-credit per-call limit.
7. Poll the job to completion. The returned asset link opens, belongs to the account and expires within 15 minutes.
8. Revoke the client in Supabase and confirm its next MCP call is refused.

## Publish tools (ADR-0112)

Seven `publish_*` tools register only while `PUBLISH_AUTOMATION_ENABLED` is on; with it off the connector is the five read-only generation tools the public page describes. The `/mcp` page and the consent screen switch to the Publish wording by themselves when the flag is on (English until translated; other languages show English for those sections). Check both pages after flipping. Acceptance, with a Publish Plan account and a disposable client: `publish_list_accounts` shows only that brand; `publish_schedule_post` for three days out creates one post and a retry with the same `idempotency_key` creates none; `publish_reschedule_post` with a stale `expected_at` is refused with 409; `publish_cancel_post` removes it from the calendar; a free account gets `publish_plan_required`.

## Ordered video references

`generate_video.source_assets` preserves order and accepts repeated `{slot, asset_id}` entries up to the selected model's `capabilities.media[slot].maxFiles`. The schema's overall bound is nine, with at most three per media kind; the runtime enforces the smaller effective model limit. `MULTI_REFERENCE_ENABLED=false` limits each slot to one. The tool sends unified ordered Library reference descriptors to the generation route. Reordered or replaced references under an existing idempotency key return `idempotency_conflict`; exact retries replay. Existing consent and price approval requirements still apply. See [ADR-0263](../adr/0263-generation-reference-limits.md).

## Uploaded sources (ADR-0100 amendment 6)

`reserve_source_upload` returns a presigned PUT from `POST /api/v1/uploads` for the signed-in account; nothing is charged. Acceptance, with a disposable client: ask for a PNG reservation, PUT the file bytes to `upload_url` with exactly the returned headers (a wrong `Content-Type` or a longer body is refused by R2), then call `generate_video` with an image-to-video model, `source_uploads: [{ key, slot: "image" }]`, `consent: true` and the confirmed price; the job must reach `succeeded` and the result must come from that still. The same key with `generate_image` and `topaz-upscale` must be accepted; `generate_image` with that model and no `source_uploads` must answer `mcp_image_only`. A key for another account's path must answer `source_not_found` from the route, never a file. An unused reservation disappears within 24 hours (`sweepUploadReservations`).

## Monitoring

- Watch 401, 409, 429 and 5xx rates on `/api/v1/mcp` separately from tool-level errors.
- Existing generation and asset-link rate limits are the abuse controls; MCP does not bypass them.
- Treat repeated `credit_confirmation_mismatch` as a stale client/catalog signal, not as a generation failure.
- Existing authorizations gained `generate_image` when it shipped (ADR-0100 amendment 2). If that is unwanted for an account, revoke its connection in Supabase or in the user's Account & security page.

## Rollback

Disable the OAuth 2.1 server or dynamic client registration in Supabase to stop new connections. Revoke existing grants to stop issued clients immediately. If the HTTP endpoint itself is faulty, roll back the application deployment; the ordinary Veyrnox studio remains on its existing routes and does not depend on MCP.
- `generate_video` and `edit_video` (ADR-0100 amendment 4) widen existing authorizations the same way, with no per-call cap; each asks for the user's acceptance of the exact price (`user_approved`). Check one: `generate_video` with a video model at 5 s; `edit_video` with `confirmed_credits: 0` must answer `credit_confirmation_mismatch` with `expected_credits` and charge nothing.

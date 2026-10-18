# ADR-0100 — Remote MCP connector

- Status: Built 2026-10-15; production activation requires the OAuth checks in `docs/operations/mcp.md`.
- Date: 2026-10-15
- Related: [ADR-0027](0027-model-capability-registry.md), [ADR-0069](0069-model-free-allowance.md), [ADR-0078](0078-admin-checks-in-code.md).

## Context

Veyrnox already has one authoritative path for model availability, pricing, rate limiting, moderation, credit debit/refund, job ownership and asset signing. MCP-capable assistants need access to that product without creating a second billing or provider path and without asking a user to paste a long-lived Veyrnox secret into another product.

## Decision

1. Serve a remote, stateless Streamable HTTP MCP endpoint at `/api/v1/mcp` using the stable v2 TypeScript SDK. It supports current and 2025-era clients from one tool definition.
2. Authenticate it with the existing Supabase ES256 access token boundary in `middleware.js`. Publish RFC 9728-style protected-resource metadata at `/.well-known/oauth-protected-resource/api/v1/mcp`, and point clients to Supabase Auth as the OAuth 2.1 authorization server.
3. Use Supabase's hosted OAuth server with dynamic client registration and PKCE. The resource owner reviews the request on `/oauth/consent`; the client never receives the browser's stored Veyrnox session token.
4. Keep MCP as an adapter over the existing route handlers. It receives the middleware-written identity and calls the same generation, job, asset and balance handlers as the web app. It does not call providers, the ledger or R2 directly.
5. Expose six small tools: model discovery, price estimation, generation, one-job status, generation history and balance. A completed job yields an ownership-checked, short-lived asset URL.
6. A write requires both an idempotency key and `confirmed_credits` equal to the current estimate. A changed price is a rejection, not implicit permission to spend more. The underlying ledger remains authoritative and a free allowance may lower the actual debit.

## Consequences

- MCP generations inherit the web app's safety, region, consent, rate, pricing, refund and ownership behavior.
- An assistant cannot select a price, provider URL or arbitrary source URL. It can reference at most two owned Library job IDs and must attest consent when it does.
- Presigned result URLs remain valid for at most 15 minutes and are not a durable MCP resource.
- Supabase OAuth-server configuration is deployment state, not repository state. The endpoint must not be advertised as production-ready until the activation runbook passes.
- Revocation and authorization records live in Supabase Auth; Veyrnox does not introduce another token store.

## Verification

- `tests/veyrnoxMcp.test.mjs` pins pricing, tool surface, OAuth discovery and the bearer challenge. `tests/mcpGenerate.test.mjs` pins every refusal of the spending tool.
- The normal generation, job, balance and identity suites continue to cover the reused handlers.
- Reticle verifies the public connector page and its endpoint-copy interaction in the running app.

## Amendment 1 (2026-10-16): the spending tool was removed

The security audit (#1065) removed `generate_media`. From that change until Amendment 2 the connector had five read-only tools, and the public page, the consent screen and the account grants list said so. This amendment records that decision; it was not written when the code changed.

## Amendment 2 (2026-10-18): a capped `generate_image` returns, at the owner's request

**Why.** The owner wants an assistant to be able to make a small image on their own account (the first use is a batch of tile pictures for the Oddlings catalog, via the owner's test account), and the connector was the intended path.

**Decision.** Add one spending tool, `generate_image`, with limits that are fixed in code (`lib/mcpGenerate.js`, `MCP_GENERATION_LIMITS`), not settings a client can raise:

- **text-to-image models only.** No video, audio, image editing, source files, uploads or consent attestation. The decision to leave those out is the point of the narrow re-add.
- **at most 2 credits per call.** A dearer model is refused before anything else is read.
- **the price must be confirmed exactly.** `confirmed_credits` must equal the live estimate; a difference is refused with no charge. The generation route repeats the check.
- **at most 40 credits per account per rolling 24 hours**, counted from the account's own newest 50 jobs (refunded jobs cost nothing). If the list cannot be read, or the 50 newest jobs are all inside the window so the total cannot be proven, the call is refused (fail closed).
- **an idempotency key is required**, so a retry is a replay and a new key is a new charge.
- Everything after those checks is the existing generation route: rate limit (10 per 60 s), moderation, debit, provider, refund. Its refusals are passed through unchanged.

**What the daily cap is and is not.** It is an account-wide bound counted from job history, so it needs no migration. It is not a per-connector counter: it counts credits spent from any source in the last 24 hours, so a heavy day in the Veyrnox app can use up the connector's allowance. Two calls in flight at once can each pass the check; the per-call limit and the rate limit bound that overshoot (at most about 10 calls of 2 credits). A retry of an already accepted key near the cap can be refused as over the cap even though it would have been a harmless replay. A per-connector counter would need a migration and goes through the apply-migrations workflow; it is a follow-up, not part of this change.

**Consequences.**
- The public page, the consent screen and the grants list now say that the connector can start small image generations. The consent screen states the limits.
- **Existing authorizations widen.** The tool is server-side and the OAuth scopes are only `openid email profile`, so a connection approved while the consent screen said "read-only" can now call `generate_image`. Anyone who wants that to stop can revoke the connection in Account & security. No re-consent is forced.
- The tool surface test now pins six tools and checks that the generation route has exactly one call site, reached only through `startMcpGeneration`.

## Amendment 3 (2026-10-18): the daily cap is removed, at the owner's request

**Why.** The 40-credit daily cap of amendment 2 stopped the owner's own trial (five hair-tile sheets) partway through: the cap counts every credit the account spent in 24 hours from any source, so spend in the app and in other sessions used it up, and the tool refused with `mcp_daily_cap_reached` while the balance was 492. The owner's position is that users may spend their own credits through the connector as freely as in the app.

**Decision.** Remove the rolling 24-hour cap and the job-history read behind it (`creditsSpentInWindow`, `dailyCreditCap`, `windowMs`, `jobsPageSize`, the `readRecentJobs` dependency and the errors `mcp_daily_cap_reached`, `mcp_daily_cap_unverifiable` and `spend_check_unavailable`). Everything else in amendment 2 stays: text-to-image only, at most 2 credits per call, an exact price confirmation, a required idempotency key, and the existing generation route (rate limit of 10 per 60 s, moderation, debit, refund) behind it.

**Consequences.**
- What bounds spend through the connector is now the account's balance, the 2-credit per-call limit and the 10-per-60-s rate limit (at most about 20 credits a minute, and only while the balance lasts).
- A leaked or runaway client can spend a whole balance in images, as a signed-in browser could. A user can revoke the connection in Account & security.
- Because the tool no longer reads the job list before spending, one failure mode goes away: the call no longer refuses when the list cannot be read.
- The tool description no longer mentions a daily limit.

## Amendment 4 (2026-10-18): `generate_video` and `edit_video`, at the owner's request

**Why.** The owner wants an assistant to create and edit video on their own account through the connector, as it already can for images.

**Decision.** Add two spending tools, both thin adapters over the existing generation route (`lib/mcpVideo.js`), with limits fixed in code (`MCP_VIDEO_LIMITS`):

- **`generate_video`**: video models only (not `clip-edit`). At most 60 credits per call (about $2 at $0.033 a credit). The price must be confirmed exactly (`estimate_generation` with `duration_seconds`). A required idempotency key. Up to two source files, each an owned finished generation named by job id and slot (`image`, `endImage`, `video`, `audio`), never a URL or upload; any source needs `consent: true`, which the assistant may set only after the user confirms rights to the media and the acceptable use policy. Ownership, MIME and size checks are the route's.
- **`edit_video`**: the Clip Editor (`clip-edit`) only: trim and join up to 10 owned clips (60 s out), optionally one owned audio file and caption preset. Its price depends on real clip lengths that only the route reads, so a call with `confirmed_credits: 0` is a quote: the route answers `credit_confirmation_mismatch` with `expected_credits` before any debit. A confirmation or a quoted price above 60 credits is refused. Slow motion and captions stay behind their own server flags.
- No daily cap (amendment 3). Rate limit, moderation, debit, refund and the video-agent plan ticket are the route's, unchanged.

**Consequences.** The connector can now spend up to 60 credits in one call, and, as with amendment 2, existing authorizations widen (revoke in Account & security). Uploads, audio generation and the video agent remain out of reach. `tests/mcpVideo.test.mjs` pins every refusal; the surface test pins eight tools and three call sites to the generation route.

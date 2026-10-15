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

- `tests/veyrnoxMcp.test.mjs` pins pricing, tool surface, OAuth discovery and the bearer challenge.
- The normal generation, job, balance and identity suites continue to cover the reused handlers.
- Reticle verifies the public connector page and its endpoint-copy interaction in the running app.

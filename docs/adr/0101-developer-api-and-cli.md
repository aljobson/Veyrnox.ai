# ADR-0101 — OAuth developer API and Veyrnox CLI

- Status: Accepted; implemented 2026-10-16
- Owners: Veyrnox platform
- Related: ADR-0100, `docs/operations/developer-api.md`

## Context

Veyrnox has a browser application and a read-only MCP connector. Developers also need a stable automation surface for scripts, CI jobs and terminals. Exposing the application's complete `/api/v1/*` tree would grant more authority than a developer client needs and would couple integrations to internal routes.

Supabase OAuth 2.1 is already enabled for the MCP connector. It provides authorization-code login with PKCE, refresh-token rotation, dynamic client registration, consent and revocation. Reusing it avoids a second credential store and keeps every integration attached to a Veyrnox user.

## Decision

1. Publish a separately documented OAuth protected resource at `/api/v1/developer`.
2. Permit OAuth access tokens only on `/api/v1/mcp` and `/api/v1/developer/*`. An OAuth token remains forbidden from every other application route.
3. Expose only model discovery, exact price estimates, account balance, generation creation, owned job reads/history and short-lived owned asset links.
4. Route developer requests through the existing catalog, generation, ledger, ownership, rate-limit, moderation, provider and refund code. The developer API does not implement a second generation engine.
5. Require `confirmed_credits` on every developer generation write. A changed price returns `409 credit_confirmation_mismatch` before debit.
6. Authenticate the official CLI as a public OAuth client using dynamic registration, a loopback redirect URI and S256 PKCE. Store rotated refresh tokens in a user-only configuration file; never ask for a Veyrnox password.
7. Publish an OpenAPI 3.1 document and a public `/developers` guide.
8. Ship the Python client as a PEP 420 package with both `veyrnox` and `cli-anything-veyrnox` console entry points. Commands support human-readable and JSON output, and no-argument invocation starts a REPL.

## Consequences

- Users can revoke CLI or API clients from the same account screen as MCP connections.
- Raw scripts must complete OAuth rather than using a permanent personal API key.
- The API inherits the existing generation and asset-link limits and failure refunds.
- The public surface is versioned and intentionally smaller than the browser application's API.
- Headless service accounts are not introduced. OAuth client-credentials and password grants remain unsupported.

## Security invariants

- Middleware verifies the ES256 access token and owns every `x-veyrnox-auth-*` header.
- A valid signed `client_id` claim is required for every developer route.
- External clients never choose an account identifier.
- Responses containing balances or signed assets are `no-store`.
- OAuth tokens presented to unrelated `/api/v1/*` routes receive `403 oauth_route_forbidden`.
- The CLI redacts tokens from output and writes its configuration with user-only permissions where supported.

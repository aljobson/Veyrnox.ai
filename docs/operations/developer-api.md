# Veyrnox developer API and CLI

## Public addresses

- Guide: `https://veyrnox.ai/developers`
- API base: `https://veyrnox.ai/api/v1/developer`
- OpenAPI: `https://veyrnox.ai/api/developer/openapi`
- OAuth protected-resource metadata: `https://veyrnox.ai/.well-known/oauth-protected-resource/api/v1/developer`

## Authentication

Clients use Supabase OAuth 2.1 authorization code with S256 PKCE. Public clients dynamically register an exact redirect URI, open the advertised authorization endpoint, exchange the code without a client secret and rotate refresh tokens whenever the token endpoint returns a replacement.

The official CLI uses a loopback callback and stores tokens locally. It never receives or stores a Veyrnox password.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | API discovery |
| `GET` | `/me` | Verified account and OAuth client identity |
| `GET` | `/models` | Active models, capabilities and prices |
| `POST` | `/estimates` | Maximum credit estimate |
| `GET` | `/balance` | Paid and free credit balance |
| `GET` | `/generations` | Owned generation history |
| `POST` | `/generations` | Create one generation after exact price confirmation |
| `GET` | `/generations/{job_id}` | Owned job status |
| `GET` | `/generations/{job_id}/asset` | Short-lived owned asset URL |

## Release acceptance

1. Protected-resource metadata and the public OpenAPI document return `200` without credentials.
2. An unauthenticated developer request returns `401` and a `WWW-Authenticate` challenge naming the developer metadata URL.
3. A normal browser access token without `client_id` is refused on developer routes.
4. An OAuth client token is refused on every `/api/v1/*` route outside MCP and the developer API.
5. Login completes through consent, and `me`, `models`, `balance` and generation history return only the approving user's data.
6. A generation with no confirmation is refused. A stale confirmation returns `409` without debit. The live estimate creates one job and the same idempotency key creates no duplicate.
7. Job status and asset links enforce ownership. Asset links expire within 15 minutes.
8. Refresh rotates stored tokens and revoked clients fail on the next authenticated request.
9. The installed `veyrnox` command passes its subprocess suite in forced-installed mode.

## Rollback

Roll back the application deployment to remove the developer routes. Existing refresh tokens then have no developer resource to call, while browser and MCP behavior stay unchanged. Individual clients can be revoked from Account & security or Supabase OAuth Apps.

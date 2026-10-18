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

## Publish routes (ADR-0112, off by default)

Available only while `PUBLISH_AUTOMATION_ENABLED` is on; otherwise every path below returns `404 publish_automation_not_open`. They run the signed-in Publish handlers, so the Publish Plan, brand role, rate limits and released-network rules are the web app's. All bodies are snake_case; `brand_id` (query or body) is optional.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/publish/brands` | Brands you can act on (when team access is open) |
| `GET` | `/publish/accounts` | Connected accounts, plan tier and account limit |
| `GET` | `/publish/posts?status&network&from&to` | Posts in a window of at most 43 days (Publish Plan); each has `updated_at` |
| `POST` | `/publish/posts` | Schedule: `scheduled_at` (at least 10 minutes ahead), `account_ids`, `media[{media_type, job_id or upload_id}]`, `text`, `idempotency_key` |
| `POST` | `/publish/posts/{id}/reschedule` | `scheduled_at`, `expected_at` (the post's current time) |
| `POST` | `/publish/posts/{id}/cancel` | `expected_updated_at` |
| `GET` | `/publish/analytics?account_id&from&to` | Period endpoints and recent posts (Publish Plan) |

There is no publish-now. A changed or already-started post returns `409`. CLI: `veyrnox publish brands|accounts|posts|analytics|schedule|reschedule|cancel`; `schedule` and `cancel` ask for confirmation unless `--yes`, and `schedule --dry-run` prints the request.

Before turning the flag on, update the public `/mcp` copy and the consent description (ADR-0112, Consequences).

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

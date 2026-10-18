# ADR-0112 — Publish tools for the MCP connector, developer API and CLI

- Status: Proposed 2026-10-18 (accepted by merging); ships off behind `PUBLISH_AUTOMATION_ENABLED`.
- Date: 2026-10-18
- Related: [ADR-0061](0061-veyrnox-publish-social-scheduling.md), [ADR-0062](0062-veyrnox-publish-entitlement-model.md), [ADR-0100](0100-remote-mcp-connector.md), [ADR-0101](0101-developer-api-and-cli.md), `docs/social-publisher/02-technical-spec.md`.

## Context

Publish already has three surfaces: the signed-in web app (`/api/v1/social/*`), a customer API for scoped, expiring `vxpub_` keys (`/api/publish/v1/*`, accounts and posts only) and outbound webhooks. Separately, ADR-0100/0101 gave Veyrnox an OAuth MCP connector and a developer API with a Python CLI, but those cover generation only. A creator who uses an assistant or a terminal cannot ask "what is scheduled this week?" or "move Friday's post".

The customer API cannot be extended to fill this gap. It has no reschedule or cancel, no analytics, and its keys are a different credential (a `vxpub_` secret) from the OAuth grant the MCP connector and CLI already use. Asking an assistant user to paste a long-lived key would undo ADR-0100's "no secret in the assistant" rule.

## Decision

1. **One adapter, no second engine.** `lib/publishAutomation.js` calls the existing signed-in handlers in process (brands, accounts, calendar, analytics, post create, reschedule, cancel), the way ADR-0100 reuses the generation handlers. Brand role, Publish Plan tier, rate limits, network release (`PUBLISH_RELEASED_NETWORKS`), media ownership and typed errors are therefore exactly the web app's; the adapter adds only stricter input limits.
2. **Two faces over that adapter.** MCP tools (`publish_list_brands`, `publish_list_accounts`, `publish_list_posts`, `publish_get_analytics`, `publish_schedule_post`, `publish_reschedule_post`, `publish_cancel_post`) in `lib/veyrnoxPublishMcp.js`; and `/api/v1/developer/publish/*` in `lib/publishAutomationApi.js`, documented in the OpenAPI file. The CLI gains `veyrnox publish brands|accounts|posts|analytics|schedule|reschedule|cancel`. No new route file is added, so no route sits outside the `/api/v1` gate and `tests/routesOutsideGate.test.mjs` is unchanged. The same OAuth boundary applies (verified token, signed `client_id`, middleware-owned identity headers); an OAuth token is still refused on every other route.
3. **Assistants schedule; they do not post on the spot.** `publishNow` is never forwarded. A scheduled time must be at least 10 minutes ahead. Media is only the caller's own finished generation (`job_id`) or verified upload (`upload_id`); there is no URL input.
4. **Optimistic concurrency, not blind writes.** Reschedule needs the post's current `scheduled_at`, cancel needs its `updated_at`; both come from `publish_list_posts`/`publish posts`. A changed or already-started post returns 409 and nothing is overwritten. Create takes an idempotency key (the CLI generates one), so a retry never makes a second post.
5. **Free tier is unchanged.** Calendar, scheduling and analytics return `402 publish_plan_required` for a free account, enforced by the handlers, never by the client or the tool description.
6. **Ships closed.** `PUBLISH_AUTOMATION_ENABLED` (a key in `PUBLISH_RUNTIME_FLAGS`) is `"false"` in production and staging. While off, the MCP tools are not registered and every `/publish/*` path answers `404 publish_automation_not_open`.
7. **Customer API stays as it is.** Key-based server-to-server posting remains the route for backends; this ADR adds nothing to `/api/publish/v1/*`.

## Consequences

- The public `/mcp` page and its ten translations say the connector is "five read-only tools" that "cannot change account data". That stays true only while the flag is off. **Flipping the flag requires first changing that copy (`mcp.what.*`, `mcp.safe.*`, `mcp.tool.*` in every catalog and `app/veyrnox/mcp/page.js`), the consent screen's description of what a connection can do, and `docs/operations/mcp.md`.** This is the owner's decision, not a code change.
- An OAuth consent today grants a client the whole developer surface; there is no per-tool scope. Once the flag is on, a connected assistant can schedule and cancel posts on the user's public accounts until the user revokes it in Account & security. The confirmation steps in tool descriptions and the CLI (`--yes`, prompts) are a courtesy, not a security boundary; the real limits are items 3-5. A narrower consent scope would need Supabase OAuth scope support and is out of this slice.
- Only YouTube, LinkedIn, X and TikTok are released in production; other accounts show `publishing_enabled: false` and are refused at create.
- Analytics are summarised as period endpoints plus recent posts, not summed, because some metrics are levels (followers).
- Not covered here: drafts, queues, approvals, upload creation, post-now, editing text of a scheduled post, restoring a canceled post, webhooks and customer-API keys.

## Verification

- `tests/publishAutomation.test.mjs` drives the developer routes and MCP registration against a stubbed database: flag off, plan tier, token-free account projection, future-only scheduling, rejection of publish-now/extra fields/bad media before any write, 409 on a changed post, unreleased network refused, brand header validation, rate limit.
- `agent-harness` unit tests cover the CLI request shapes and the `--yes`/`--dry-run` guards.
- Before enabling: run the acceptance steps in `docs/operations/mcp.md` with a Publish Plan account and one disposable client, schedule a post three days out, reschedule it, cancel it, and confirm the calendar in the web app shows each change.

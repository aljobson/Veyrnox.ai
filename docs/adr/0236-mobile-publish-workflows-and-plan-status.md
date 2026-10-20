# ADR-0236: Mobile Publish workflows and plan status

Status: Accepted.

## Context

The frozen work order, including Revision 2, adds workflow reads and a price-free Publish Plan status surface. Source paths below are relative to this checkout.

## Decision

Add exactly one entry to the existing Publish menu array, Workflows. Its screen includes an independently loaded “Your Publish Plan” card and expandable workflow details. Follow the native inbox screen's theme, `usePublishApi`, focus refresh, list and touch-target conventions. A labelled Refresh control retries both reads. No custom animations or animated loaders are used, including when expanding details. All visible headings have the header accessibility role, controls have at least 44-point targets, and the list scrolls at large text sizes.

Workflow reads use `GET /api/v1/social/workflows` with the existing selected-brand client. The route resolves brand access for owner, manager, editor, reviewer, analyst and viewer. Fields come from `list_social_inbox_workflows` in `packages/db/schema/supabase/0320_social_inbox_workflows.sql`: name, account scope, kind, keyword, match mode, enabled, suggested reply, suggestion count and updated timestamp. Names and third-party text are bounded plain text. Provider text/URLs are never used as link destinations. Malformed values remain unknown.

There is no workflow detail endpoint. Details expand from the list response, including the configured reply and account scope. `updated_at` is labelled “Last edited”; `suggestion_count` is labelled “Suggestions”. Neither is a last-run timestamp.

### Write-by-write decision

The web implementation was read at `app/veyrnox/app/publish/workflows/page.js`, `app/lib/socialInboxClient.js` and `app/api/v1/social/workflows/route.js`, together with migration 0320.

| Action | Existing web behavior | New phone surface |
| --- | --- | --- |
| Turn on/off | Checkbox in the full workflow editor, saved with PUT and all fields | Web only. The frozen order permits this only if a plain PATCH exists; none exists. Do not simulate a toggle by replaying a stale full workflow. |
| Create/edit a rule or reply | PUT of the full definition, for owner/manager/editor | Web only |
| Delete | DELETE with the workflow ID | Web only; outside the allowed mobile writes |
| Use/send replies, outbound messages, public posts, credit spending | Separate actions outside the workflow read | No action on this surface |

Migration 0320's evaluator creates reviewable reply suggestions; saving a rule does not send a reply or charge credits. That does not satisfy the work order's explicit PATCH condition. The only workflow handoff is a “Continue on web” row opening the fixed `/app/publish/workflows` page using the existing browser convention. The canonical public path is established by `next.config.mjs`; `/veyrnox` is a source prefix. Web sign-in and brand selection remain the web's responsibility. A browser-open failure shows local, nontechnical text.

### Plan contract and purchase boundary

`GET /api/v1/social/plan` delegates to `lib/social/publishPlanApi.js`. Parse only the entitlement: `tier`, `account_limit`, `analytics_days`, `best_time_enabled`, and subscription source, status, period end and cancellation-at-period-end. The plan route is person-scoped, independent of workflow availability.

Display “Connected account limit”, analytics history in days and best-time availability. Do not show team seats. When a period-end date is present, show “Renews” only for an active subscription explicitly not ending; “Ends” for cancellation at period end; otherwise “Current period ends”. Omit the date line when no period-end date is available. Unknown values do not become free, zero or disabled.

Publish Plan subscriptions can originate from Stripe **or a store**, as supported by migration 0346 and `publicEntitlement().subscription.source`. The former Stripe-only premise is incorrect. Show plain, noninteractive text “Manage your plan on the web” for `stripe`, “Manage your plan in your store subscriptions” for `store`, and no management text for an unknown source.

The new surface does not expose prices, catalogue names, purchase, upgrade, cancel, checkout, billing links or an unlock/paywall component. The existing phone store purchase flow and its client remain unchanged. General store-billing/product policy remains an owner decision; this work does not resolve it or make a new policy claim.

### Unavailable and stale data

The server is authoritative for flags: the workflow route rejects disabled inbox/workflow/plan flags with 503; the plan route rejects a disabled plan flag with 503. Both new reads map 402/403/404/503 to “Not available yet” and other failures to safe local messages. The plan card remains usable when workflows are unavailable and vice versa. A malformed workflow envelope is unavailable, not a successful empty list; a malformed plan is unknown, never assumed free.

Refocusing, refreshing or changing the selected-brand API clears prior read results. Async cleanup ignores completions after blur or dependency changes. The rendered result is also tied to the API instance so a previous brand's data cannot briefly appear under the new one.

## Open work and limitations

- A genuine workflow last-run timestamp requires a future server contract; it is not inferred here.
- A mobile on/off control would require the permitted PATCH contract and separate approval of its semantics.
- The Publish Plan store billing question remains an owner decision; the existing store purchase flow is unchanged.
- No server routes, flags, migrations, analytics SDKs or billing behavior change.
- Tests cover parser contracts, safe errors, GET-only calls, management/renewal semantics and native source wiring. They do not constitute a simulator or screen-reader pass.

## Verification

```sh
cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check
```

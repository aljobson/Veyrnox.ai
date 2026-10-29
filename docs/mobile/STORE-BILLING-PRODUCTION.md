# Store billing production activation

Owner runbook, 2026-10-29. This change sets no secrets, flags, store products or migrations. Run commands from a clean checkout of main containing the sales gate, after independent review. Android stays off until Play credentials and its own sandbox proof exist. Do not attach Android products to saleable offerings yet.

`STORE_BILLING_ENABLED=true` records events and serves the customer route. `STORE_SALES_ENABLED=true` permits the updated phone to start purchases. Both default closed; closing sales leaves recording, Restore, entitlements and refunds working. These two switches and `REVENUECAT_WEBHOOK_SECRET` are production **Worker secrets**, not public vars. Never set `STORE_BILLING_ALLOW_SANDBOX` in production, even as a secret. Production ignores sandbox/TestFlight purchases.

Builds 17–19 ignore `sales_open` and can buy whenever recording is on. **Do not enable production recording until a build containing this gate is the only build in TestFlight and in review.** Owner: expire/remove the older TestFlight builds and replace any review submission; verify the build inventory and installed version. If an older release remains usable, stop rollout until it is retired: the new switch cannot protect old code.

The readiness checker reports configuration, not working payments. Supply a RevenueCat v2 key through the local `REVENUECAT_API_KEY` environment without shell tracing or pasting it into logs. It needs read permissions for apps, products, offerings, packages, entitlements and (after catalog stage) integrations. Project defaults to `proj36a3504f`; override with `--project` or `REVENUECAT_PROJECT_ID`. `--store` defaults to `ios`; other stores are marked excluded. Optional `--worker` checks all live version binding **names**, never values. Optional `--probe` sends only an unsigned, empty POST and prints its status. A skipped check is not evidence it passed. Tests use documented API response shapes populated with synthetic products, not a live project recording.

## 1. Create App Store products — owner, App Store Connect

Generate the authoritative table and its machine-readable equivalent:

```sh
node scripts/store-billing-catalog.mjs
node scripts/store-billing-catalog.mjs --json
```

Use the **ios** rows for app 6824181474 (`ai.veyrnox.app`). Create the three consumables and the Publish and Generation auto-renewable subscriptions. Use separate Publish and Generation subscription groups; include all cadences/families within the appropriate group. Complete localization, review screenshots, review information and availability. Copy product identifiers exactly. Use the migration USD prices and credits; the owner may change them only with a new migration. If a price point cannot be selected, stop and propose that migration rather than silently choosing a nearby price.

Verify each product's kind, period, USD price and identifier against the generated table. Generation annual subscriptions grant the table's monthly credit allocation month by month; the price is annual. The reader derives values from migrations through 0394, including 0381/0383 credit changes and 0385 yearly activation. Android qualified `productId:basePlanId` rows are future setup targets, not duplicates of historical unqualified mappings. Retired packs stay in the database for settlement and are absent from this saleable list.

## 2. Configure RevenueCat — owner, RevenueCat dashboard

Attach the iOS products to app `app57f83ace37`. Rebuild offering `credits` to packages `100`, `300`, `1000`; remove the stale `270`, `1200`, `3000` packages. Create offerings `publish` and `generation` and the exact custom package lookup keys printed in the table (Publish: `weekly`, `monthly`, `annual`; Generation: `<family>-monthly`, `<family>-annual`). Attach the corresponding store product to each package for all customers. Remove stale/empty packages rather than retaining saleable retired products. Named offerings are what the phone reads; a current offering alone is insufficient.

Create active entitlements `publish` and `generation`. Attach exactly the respective Publish and Generation products, with no cross-family attachments and **no entitlement on consumable packs**. Verify each product, package and entitlement in the dashboard.

Widen the existing staging sandbox webhook `whintgrea551ef462` to all eight event types:

```text
non_renewing_purchase, cancellation, initial_purchase, renewal,
product_change, uncancellation, billing_issue, expiration
```

Keep the staging webhook pointed to staging and scoped to the intended app. Verify signing is enabled and the staging signing secret matches. Reference: [RevenueCat v2 integration API](https://www.revenuecat.com/docs/api-v2/integration), [package attachments](https://www.revenuecat.com/docs/api-v2/package), [entitlements](https://www.revenuecat.com/docs/api-v2/entitlement).

## 3. Check the catalog — owner or release engineer

```sh
node scripts/check-store-billing-readiness.mjs --store ios --stage catalog
```

Require exit 0 and no failed checks. This stage checks only RevenueCat apps, active products, packages and entitlements. It does not inspect webhooks, Worker bindings, actual store availability, review approval or a working payment. Check store prices manually in step 1.

## 4. Prove the complete sandbox flow on staging — release engineer and owner

Staging already has recording and sandbox crediting enabled. It is **not** deployed automatically from main. Follow [staging-deploy.md](../operations/staging-deploy.md) exactly, from main containing this change, with the full build environment. Reuse the consolidated mobile environment for phone testing; do not create another native install.

### a. Build, verify, then deploy staging

```sh
git checkout main && git pull
APP_ENV=staging SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY='<staging publishable key from wrangler.jsonc>' \
PUBLIC_HOST=https://veyrnox-ai-staging.al-jobson.workers.dev \
~/.local/bin/with-build-slot npm run build:worker
npm run verify:baked-env -- staging
# STOP if verification fails. Only after it passes:
npx wrangler deploy --env staging
```

Verify the live version from `npx wrangler deployments list --env staging --json` is the version just deployed from that verified bundle. Confirm `sales_open` exists in the local `.open-next` bundle (`rg -l sales_open .open-next`), and use the authenticated live request below to confirm the deployed route has the new field. A deployment success message alone is insufficient.

### b. Open staging sales and deploy the created version

```sh
npx wrangler versions secret put STORE_SALES_ENABLED --env staging
# Enter true at the prompt; copy the version ID printed by the command.
npx wrangler versions deploy <printed-version-id>@100 --env staging -y
```

`versions secret put` creates an **undeployed** version. If the 128-binding limit refuses it, follow the staging capacity note in `wrangler.jsonc` to free a binding before retrying; do not delete unrelated secrets casually. Verify the created version is now 100% live.

### c. Verify the authenticated customer response

Sign in with a staging phone build. In a trusted local terminal, provide its staging Supabase access token in `STAGING_ACCESS_TOKEN` without logging it, then run this exact request. It prints only the boolean, never the customer ID or token:

```sh
node --input-type=module <<'JS'
const r = await fetch('https://veyrnox-ai-staging.al-jobson.workers.dev/api/v1/store-purchases/customer', {
  headers: { Authorization: `Bearer ${process.env.STAGING_ACCESS_TOKEN}` }, cache: 'no-store',
});
if (r.status !== 200) throw new Error(`Customer HTTP ${r.status}`);
const body = await r.json();
if (typeof body.sales_open !== 'boolean') throw new Error('Live bundle lacks sales_open');
console.log({ sales_open: body.sales_open });
JS
```

Require `sales_open: true`. Focus Credits and confirm buy buttons enable. Background/foreground the app and visit Account and Publish: the state must refresh without signing out.

### d. Run sandbox end-to-end checks

Owner buys a sandbox pack: it grants exactly once. Release engineer replays the signed delivery in RevenueCat: no second grant. Buy a subscription, confirm its entitlement and accelerated renewal; refund a purchase and confirm the clawback. Restore must work. Check the staging ledger, subscription records and delivery outcomes, not just the purchase sheet. Reuse the read-only query in step 7 with the corresponding staging transaction/event/customer identifiers; record evidence privately.

### e. Close staging sales, deploy and test settlement

```sh
npx wrangler versions secret delete STORE_SALES_ENABLED --env staging
npx wrangler versions deploy <printed-version-id>@100 --env staging -y
```

Repeat the authenticated request: require `sales_open: false`. Focus/foreground the phone: new purchases are refused and Restore is enabled. Refund an existing sandbox purchase and verify it still processes while sales are closed. Recording and its signing secret remain bound.

## 5. Enable production recording with sales closed — owner and release engineer

First verify the old-build retirement requirement above and successful staging evidence. Ensure `STORE_SALES_ENABLED` is absent in production. Add a separate webhook at `https://veyrnox.ai/api/webhook/revenuecat`, environment **production**, covering the iOS app and all eight event types from step 2. Copy its signing secret securely.

```sh
npx wrangler versions secret put REVENUECAT_WEBHOOK_SECRET
npx wrangler versions secret put STORE_BILLING_ENABLED
# Signing secret at the first prompt; true at the second.
gh workflow run deploy-production.yml --ref main
```

Wait for deploy-production on main to complete successfully and verify its live version preserves both secret names. Each `versions secret put` creates a new, undeployed version from the newest upload; a branch preview uploaded between the two commands (or before the deploy) can leave one name behind, as happened with `CREATOR_PROFILE_ENABLED` on 2026-10-29. If `--worker` reports a name missing, put it again and redeploy main. Secret uploads alone do not activate them. Do not use the force-recovery option for routine activation.

```sh
node scripts/check-store-billing-readiness.mjs --store ios --stage recording --worker --probe https://veyrnox.ai
```

Require exit 0, `sales closed`, and probe HTTP 401. A 404 means recording is off; a 503 means signing-secret or gateway configuration is missing (the route requires both). Fix the cause while sales stay closed. Binding presence cannot prove the flag value or the signing secret matches RevenueCat.

Use RevenueCat's **send test event** on the production webhook. Require a signed delivery returning 200 with an ignored test-event outcome and no credits granted. Only this signed delivery proves the signing secret. Keep evidence of the live version and delivery status.

## 6. Open production sales — owner and release engineer

```sh
npx wrangler versions secret put STORE_SALES_ENABLED
# Enter true, then deploy main and wait for success.
gh workflow run deploy-production.yml --ref main
node scripts/check-store-billing-readiness.mjs --store ios --stage selling --worker
```

Require exit 0. Because secret values are not disclosed by the checker, additionally verify the authenticated production customer response says `sales_open: true` using step 4c's request with the production origin and production account token. Focus Credits on the new build; verify it enables purchase controls. Do not test real credit delivery using TestFlight: its sandbox events are intentionally ignored by production.

## 7. Match the first real purchase — owner buys; release engineer verifies read-only

Owner makes the smallest real iOS pack purchase (100 credits). From the RevenueCat customer history, locate the event by **App Store transaction ID** and record that event's ID, product ID, and the resolving `app_user_id` (or `original_app_user_id` if merged). The database stores event ID and type, not the transaction payload, so this RevenueCat evidence is needed to tie the webhook row to the transaction. Run in a trusted SQL console as an authorized reader of these tables/functions; keep account/customer identifiers private:

```sql
BEGIN TRANSACTION READ ONLY;
WITH evidence AS (
  SELECT '<app-store-transaction-id>'::text AS transaction_id,
         '<revenuecat-event-id-from-that-transaction>'::text AS event_id,
         '<resolving-revenuecat-customer-uuid>'::uuid AS rc_customer_id,
         '<expected-internal-user-uuid>'::uuid AS expected_user_id,
         'ai.veyrnox.credits.100'::text AS product_id,
         100::integer AS expected_credits
)
SELECT e.transaction_id, w.external_id AS event_id, w.processed_at,
       t.id AS top_up_id, t.order_id, t.status, t.user_id,
       sc.user_id = e.expected_user_id AS correct_account,
       t.user_id = sc.user_id AS customer_matches_top_up,
       p.store_product_id, p.store_product_id = e.product_id AS correct_product,
       t.credits, t.credits = e.expected_credits AS correct_credits,
       l.id AS grant_entry_id, l.delta, l.free_delta, l.reason,
       l.user_id = t.user_id AND l.delta = e.expected_credits
         AND l.free_delta = 0 AND l.reason = 'grant:topup' AS correct_grant
FROM evidence e
LEFT JOIN public.webhook_events w
  ON w.source = 'billing:revenuecat' AND w.external_id = e.event_id
LEFT JOIN public.store_customers sc ON sc.rc_customer_id = e.rc_customer_id
LEFT JOIN public.top_ups t
  ON t.order_id = public.store_order_id('ios', e.transaction_id)
 AND t.sales_channel = 'ios'
LEFT JOIN public.credit_packs p ON p.id = t.pack_id
LEFT JOIN public.ledger_entries l ON l.id = t.grant_entry_id;
SELECT * FROM public.reconcile_top_ups();
SELECT * FROM public.reconcile_balances();
ROLLBACK;
```

Require one matched webhook with `processed_at`, one `credited` top-up, the correct account, product and credits, and one matching grant. Every boolean must be true, not null; both reconciliation calls must return zero rows. This follows `credit_store_purchase` → `ledger_grant`, with the join through `top_ups.grant_entry_id` (0358), and the hashed `store_order_id` (0344); it does not assume a `credit_top_up` ledger reason or raw transaction string in the order column.

A missing webhook row means the event was not accepted into processing; inspect delivery logs for never-arrived, rejected, or ignored deliveries. Retry from RevenueCat within its roughly 80-minute retry window, or re-send from the customer's history. A processed webhook alone is not enough: permanent purchase errors can also be marked processed without a grant. Repeat this exact match after recovery.

## 8. Roll back by closing sales — owner and release engineer

```sh
npx wrangler versions secret delete STORE_SALES_ENABLED
gh workflow run deploy-production.yml --ref main
```

Wait for the new live version, verify the authenticated customer response is `sales_open: false`, and repeat the recording-stage checker/probe. Verify the new build refuses purchases after focus/foreground and Restore works. New purchase SDK calls also re-read the server, so a stale open UI cannot bypass a closed switch. A purchase already in the store sheet may still complete and must settle.

**Never delete `STORE_BILLING_ENABLED` or `REVENUECAT_WEBHOOK_SECRET` while any store purchase or subscription exists.** Renewals, refunds and in-flight purchases must keep recording. If recording was down, replay every undelivered event from RevenueCat before its retry window closes, use customer history for older events, and run step 7's transaction match for each pack purchase (and the corresponding subscription/event checks for subscription deliveries). Keep sales closed until reconciliation is complete. Closing sales is the rollback; do not roll the application back to a build that ignores the sales switch.

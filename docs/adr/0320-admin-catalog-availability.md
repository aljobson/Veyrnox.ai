# ADR-0320 — Admin catalog availability

Status: accepted for implementation; owner review pending.

Owners may request availability changes only for the current web packs (web-209, web-523, web-1571, from 0420), with a reason, an idempotency key and trusted AAL2 freshness rechecked after locks in SQL. Finance and viewers may read. Prices and credit amounts remain immutable here: payment products and ADR-0014's price floor require a separate owner decision. Every successful change and its receipt are atomic with the audit row.

Subscription plans are effectively read-only, including retired weekly plans. A store mapping is a permanent refusal in this build, irrespective of local counts. Store initial purchases and renewals have no local row until notification; local counts cannot prove an absence of in-flight payments. Current consumers are `lib/subscriptions/api.js` (eight LAUNCH_PLANS; discovery capped at ten), `create_credit_subscription` (0186, later replacements), `list_credit_subscription_plans`, `apply_store_generation_event` (0422: active join for activation/renewal), Stripe `lib/subscriptions/webhook.js` and trial conversion (`lib/subscriptions/trial.js`, `grant_trial_starter_credits` in 0422), and the yearly cycle grant (0383). Stripe status/invoice and yearly grants use the subscription snapshot; store renewal still resolves an active plan. No subscription row can be changed by this admin surface. Separating sale availability from settlement eligibility remains follow-up work.

Pack checkout (`app/api/v1/top-ups/route.js`, `create_pending_top_up` in 0344) accepts an active web catalog row, not an explicit ID allowlist. The internal service-inaccessible `admin_editable_pack_ids()` SQL helper defines the current three 0420 web pack IDs once and is used by both the list editable field and mutation guard. Because there is no checkout code ID allowlist, the agreement test compares this helper to the 0420 launch catalog and checks checkout still uses active web catalog rows. This is an explicit deviation from the requested code-allowlist comparison; checkout acceptance is not narrowed. The admin allowlist deliberately uses only those launch IDs; retired and mobile packs remain read-only. There is no stored per-plan feature matrix or Stripe price mapping: the page reads existing subscription policy copy and actual store mappings without inventing entitlements or product IDs.

Owner decision: **documented divergence** from the initial 0420/0421 catalog
parity assertions. Web packs and store packs are managed separately; neither
activation nor deactivation has a store-parity refusal or changes a store row.
The Plans page shows each web pack's matching iOS/Android packs (matched by Credits)
and their active states read-only, and says web deactivation does not stop store
sales. Store catalog changes remain an owner migration decision. The acceptance
script toggles web availability in both directions while store packs remain active,
checks the displayed matching rows, and verifies all store states are unchanged.

The pack deactivation guard counts only pending top-ups created within the last three hours: the checkout route's one-hour bucket produces sessions expiring one to two hours out, plus a one-hour lateness margin. The actual status CHECK is pending/credited; refunded purchases remain credited with refunded_cents and are explicitly excluded by the pending whitelist. No abandoned-checkout expiry sweep changes these pending rows in this checkout;
counting every pending row would block forever. Keep the three-hour guard rather
than adding an expiry workflow in this change. A retry of an old pending top-up can create a new session using the current bucket without advancing created_at, so age is not proof that checkout has expired. This count is a guard, not a proof that no checkout is in flight. Concurrent checkout can already hold a catalog snapshot. All Stripe confirmation, webhook, recovery and late deliveries settle through `credit_top_up` (0413) using that top-up snapshot without looking up active packs (the current web credit_top_up replacement is in 0413; 0344 around
line 276 separately proves the store settlement path ignores active); refunds use recorded purchases (0257), and store purchases (0344) deliberately do not filter packs on active. Thus an accepted availability change cannot make an existing pack settlement return pack-not-found. The local acceptance script explicitly creates a pending top-up before deactivation, ages it beyond the guard, deactivates, and proves its first settlement succeeds, as well as duplicate and late snapshot settlement. No 72-hour guard is needed because settlement never consults pack active; no raw ledger writer is introduced.

Public pack responses retain the existing 300-second shared cache and 60-second stale-while-revalidate policy (`/api/credit-packs`), with a separate 300-second SSR cache (`publicCreditPacks`). Subscription discovery is already no-store, not TTL cached. No cache invalidation or payment flow is changed.

Proof: focused `adminPlans.test.mjs`; host runs `test-admin-panel-plans.mjs` on an isolated local database, including replay, authorization, freshness, refusal, audit and money reconciliation.
